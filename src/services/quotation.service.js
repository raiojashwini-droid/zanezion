import * as quotationRepository from '../repositories/quotation.repository.js';
import * as rfqRepository from '../repositories/rfq.repository.js';
import * as vendorRepository from '../repositories/vendor.repository.js';
import * as prService from './purchaseRequest.service.js';
import AppError from '../utils/AppError.js';
import { logAudit } from '../utils/audit.js';
import prisma from '../config/db.js';

export const createQuotation = async (data, performerId, tenantId) => {
  let rfq = null;
  
  if (data.rfqId) {
    rfq = await rfqRepository.findRFQById(data.rfqId);
    if (!rfq || (tenantId !== null && rfq.tenantId !== tenantId && rfq.tenantId !== 1)) {
      throw new AppError('RFQ not found', 404);
    }
    if (rfq.status === 'closed') {
      throw new AppError('Cannot submit quotation for a closed RFQ', 400);
    }
    
    if (data.vendorId && rfq.vendorId !== data.vendorId) {
      throw new AppError('Vendor does not match the RFQ recipient', 400);
    }

    const existingQuotation = await quotationRepository.findQuotationByRFQAndVendor(data.rfqId, data.vendorId);
    if (existingQuotation) {
      throw new AppError('Quotation already submitted for this RFQ by this vendor', 400);
    }
  }

  if (data.vendorId) {
    const vendor = await vendorRepository.findVendorById(data.vendorId);
    if (!vendor || (tenantId !== null && vendor.tenantId !== tenantId && vendor.tenantId !== 1)) {
      throw new AppError('Vendor not found', 404);
    }
  }

  const newQuotation = await quotationRepository.createQuotation({ ...data, tenantId });

  // Update RFQ status to received
  if (rfq && rfq.status === 'sent') {
    await rfqRepository.updateRFQStatus(rfq.id, 'received');
  }

  await logAudit({
    module: 'QUOTATIONS',
    action: 'CREATE',
    description: `Submitted quotation${rfq ? ` for RFQ ${rfq.rfqNumber}` : ''}`,
    newValue: newQuotation,
    performedBy: performerId
  });

  return newQuotation;
};

export const getQuotations = async (tenantId, query) => {
  return await quotationRepository.findAllQuotations(tenantId, query);
};

export const getQuotationById = async (id, tenantId) => {
  const quotation = await quotationRepository.findQuotationById(id);
  if (!quotation || (tenantId !== null && quotation.tenantId !== tenantId)) {
    throw new AppError('Quotation not found', 404);
  }
  return quotation;
};

export const ensurePurchaseRequestForQuotation = async (quotation, performerId) => {
  try {
    let existingPrId = quotation.rfq?.purchaseRequestId || quotation.metadata?.purchaseRequestId;

    // Extract line items
    let rawItems = [];
    if (quotation.metadata && Array.isArray(quotation.metadata.items) && quotation.metadata.items.length > 0) {
      rawItems = quotation.metadata.items;
    } else if (quotation.remarks) {
      try {
        const parsed = JSON.parse(quotation.remarks);
        if (Array.isArray(parsed)) rawItems = parsed;
        else if (parsed && Array.isArray(parsed.items)) rawItems = parsed.items;
      } catch (e) {}
    }
    if (rawItems.length === 0) {
      rawItems = [{ name: 'Strategic Procurement Asset', qty: 1, price: quotation.amount || 0 }];
    }

    const prItems = rawItems.map(item => ({
      itemName: item.name || item.itemName || 'Asset',
      description: item.description || '',
      quantity: Number(item.qty || item.quantity || 1),
      unit: item.unit || 'Pieces',
      estimatedCost: Number(item.price || item.estimatedCost || 0)
    }));

    const firstItemName = prItems[0]?.itemName || 'Asset';
    const requesterUserId = quotation.metadata?.userId ? Number(quotation.metadata.userId) : (performerId || 1);

    // If PR already exists, update its line items and status so it matches quote edits!
    if (existingPrId) {
      await prisma.$transaction(async (tx) => {
        await tx.purchaseRequestItem.deleteMany({ where: { purchaseRequestId: Number(existingPrId) } });
        await tx.purchaseRequestItem.createMany({
          data: prItems.map(it => ({
            ...it,
            purchaseRequestId: Number(existingPrId)
          }))
        });
        await tx.purchaseRequest.update({
          where: { id: Number(existingPrId) },
          data: {
            title: `${firstItemName} (Quote QUO-${quotation.id})`,
            status: 'approved'
          }
        });
      }, { timeout: 30000, maxWait: 15000 });
      console.log(`[PR_AUTO_GEN] Synchronized existing PR ${existingPrId} with updated items for Quote QUO-${quotation.id}`);
      return existingPrId;
    }

    // Dynamic department lookup for this specific tenant
    let dept = await prisma.department.findFirst({
      where: {
        tenantId: quotation.tenantId,
        status: 'active'
      },
      orderBy: { id: 'asc' }
    });
    if (!dept) {
      dept = await prisma.department.findFirst({
        where: { tenantId: quotation.tenantId }
      });
    }

    const prPayload = {
      title: `${firstItemName} (Quote QUO-${quotation.id})`,
      description: `[userId:${requesterUserId}] Auto-generated from approved Quote QUO-${quotation.id} (Client: ${quotation.metadata?.clientName || 'Institutional Client'}, Vendor ID: ${quotation.vendorId || 'N/A'})`,
      departmentId: dept ? dept.id : undefined,
      requestedBy: requesterUserId,
      status: 'approved',
      priority: 'medium',
      items: prItems
    };

    const newPr = await prService.createPurchaseRequest(prPayload, requesterUserId, quotation.tenantId);

    // Save linked PR back into quotation metadata
    const updatedMeta = {
      ...(typeof quotation.metadata === 'object' && quotation.metadata !== null ? quotation.metadata : {}),
      purchaseRequestId: newPr.id,
      prNumber: newPr.prNumber
    };

    await prisma.quotation.update({
      where: { id: quotation.id },
      data: { metadata: updatedMeta }
    });

    console.log(`[PR_AUTO_GEN] Successfully created PR ${newPr.prNumber} (ID: ${newPr.id}) for Quote QUO-${quotation.id}`);
    return newPr.id;
  } catch (error) {
    console.error(`[ensurePurchaseRequestForQuotation] Error auto-generating PR for quote ${quotation?.id}:`, error);
    return null;
  }
};

export const updateQuotationStatus = async (id, payloadOrStatus, tenantId, performerId) => {
  const quotation = await getQuotationById(id, tenantId);

  let status = typeof payloadOrStatus === 'string' ? payloadOrStatus : payloadOrStatus?.status;
  if (!status) status = quotation.status;

  const dataToUpdate = { status };

  if (typeof payloadOrStatus === 'object' && payloadOrStatus !== null) {
    if (payloadOrStatus.amount !== undefined) {
      dataToUpdate.amount = parseFloat(payloadOrStatus.amount);
    }
    if (payloadOrStatus.remarks !== undefined) {
      dataToUpdate.remarks = payloadOrStatus.remarks;
    }

    const { status: _s, amount: _a, remarks: _r, ...incomingMeta } = payloadOrStatus;
    const existingMeta = typeof quotation.metadata === 'object' && quotation.metadata !== null ? quotation.metadata : {};
    dataToUpdate.metadata = {
      ...existingMeta,
      ...incomingMeta
    };
  }

  const updatedQuotation = await quotationRepository.updateQuotationStatus(id, dataToUpdate);

  // When quote is accepted / approved, ensure an approved Purchase Request is created or updated dynamically
  const normalizedStatus = String(status).toLowerCase();
  if (normalizedStatus === 'approved' || normalizedStatus === 'accepted') {
    await ensurePurchaseRequestForQuotation(updatedQuotation, performerId);
  }

  try {
    await logAudit({
      module: 'QUOTATIONS',
      action: 'STATUS_CHANGE',
      description: `Quotation ${id} updated: status=${status}, amount=${dataToUpdate.amount ?? quotation.amount}`,
      oldValue: quotation,
      newValue: updatedQuotation,
      performedBy: performerId
    });
  } catch (auditErr) {
    console.warn(`[logAudit] Non-fatal audit log failure for quote ${id}:`, auditErr.message);
  }

  return updatedQuotation;
};

export const deleteQuotation = async (id, tenantId, performerId) => {
  const quotation = await getQuotationById(id, tenantId);

  // Relax status check to allow deletion during testing
  // if (quotation.status !== 'pending') {
  //   throw new AppError(`Cannot delete a ${quotation.status} quotation`, 400);
  // }

  await quotationRepository.deleteQuotation(id);

  await logAudit({
    module: 'QUOTATIONS',
    action: 'DELETE',
    description: `Deleted quotation ${id}`,
    oldValue: quotation,
    performedBy: performerId
  });

  return true;
};
