import * as quotationService from '../services/quotation.service.js';
import { sendResponse } from '../utils/response.js';
import { resolveTenantId } from '../utils/tenantResolver.js';
import prisma from '../config/db.js';

export const createQuotation = async (req, res, next) => {
  try {
    const isSuperAdmin = req.user.role?.name === 'SUPER_ADMIN';
    const tenantIdToUse = isSuperAdmin ? (req.body.tenantId || req.user.tenantId || 1) : (req.user.tenantId || 1);
    const { rfqId, vendorId, amount, remarks, tenantId, status, ...metadata } = req.body;
    
    // Auto-parse integers if passed as strings
    const rfqIdInt = rfqId ? parseInt(rfqId, 10) : undefined;
    const vendorIdInt = vendorId ? parseInt(vendorId, 10) : undefined;
    const amountFloat = amount ? parseFloat(amount) : 0;

    let clientId = req.body.clientId || req.user.clientId;
    if (!clientId) {
      const clientRec = await prisma.client.findFirst({
        where: {
          OR: [
            { email: req.user.email },
            { companyName: req.user.name || '' }
          ]
        }
      });
      if (clientRec) clientId = clientRec.id;
    }

    const quotationPayload = {
      rfqId: rfqIdInt,
      vendorId: vendorIdInt,
      amount: amountFloat,
      remarks: remarks || '',
      status: status || 'pending',
      metadata: {
        ...metadata,
        userId: req.user.id,
        clientId: clientId || null,
        clientName: req.user.name || null
      }
    };

    const quotation = await quotationService.createQuotation(quotationPayload, req.user.id, tenantIdToUse);
    sendResponse(res, 201, 'Quotation submitted successfully', quotation);
  } catch (error) {
    next(error);
  }
};

export const getQuotations = async (req, res, next) => {
  try {
    const tenantIdToFilter = resolveTenantId(req);
    const roleName = String(req.user.role?.name || req.user.role || '').toUpperCase();

    const isClientRole = ['INDIVIDUAL_CLIENT', 'CUSTOMER', 'BUSINESS_CLIENT', 'CLIENT'].includes(roleName);
    if (isClientRole) {
      let resolvedClientId = req.user.clientId;
      if (!resolvedClientId) {
        const clientRec = await prisma.client.findFirst({
          where: {
            OR: [
              { email: req.user.email },
              { companyName: req.user.name || '' }
            ]
          }
        });
        if (clientRec) resolvedClientId = clientRec.id;
      }
      req.query.clientId = resolvedClientId || -1;
      req.query.userId = req.user.id;
    }

    const result = await quotationService.getQuotations(tenantIdToFilter, req.query);
    sendResponse(res, 200, 'Quotations fetched successfully', result);
  } catch (error) {
    next(error);
  }
};

export const getQuotationById = async (req, res, next) => {
  try {
    const tenantIdToFilter = resolveTenantId(req);
    const roleName = String(req.user.role?.name || req.user.role || '').toUpperCase();

    const quotation = await quotationService.getQuotationById(Number(req.params.id), tenantIdToFilter);
    if (!quotation) {
      return sendResponse(res, 404, 'Quotation not found');
    }

    const isClientRole = ['INDIVIDUAL_CLIENT', 'CUSTOMER', 'BUSINESS_CLIENT', 'CLIENT'].includes(roleName);
    if (isClientRole) {
      let resolvedClientId = req.user.clientId;
      if (!resolvedClientId) {
        const clientRec = await prisma.client.findFirst({
          where: {
            OR: [
              { email: req.user.email },
              { companyName: req.user.name || '' }
            ]
          }
        });
        if (clientRec) resolvedClientId = clientRec.id;
      }
      const meta = quotation.metadata || {};
      const matchesClient = resolvedClientId && (Number(meta.clientId) === Number(resolvedClientId) || String(meta.clientId) === String(resolvedClientId));
      const matchesUser = Number(meta.userId) === Number(req.user.id) || String(meta.userId) === String(req.user.id);
      if (!matchesClient && !matchesUser) {
        return sendResponse(res, 404, 'Quotation not found');
      }
    }

    sendResponse(res, 200, 'Quotation fetched successfully', quotation);
  } catch (error) {
    next(error);
  }
};

export const updateQuotationStatus = async (req, res, next) => {
  try {
    const tenantIdToFilter = resolveTenantId(req);
    const { status } = req.body;

    const updatedQuotation = await quotationService.updateQuotationStatus(Number(req.params.id), status, tenantIdToFilter, req.user.id);
    sendResponse(res, 200, 'Quotation status updated successfully', updatedQuotation);
  } catch (error) {
    next(error);
  }
};

export const deleteQuotation = async (req, res, next) => {
  try {
    const tenantIdToFilter = resolveTenantId(req);

    await quotationService.deleteQuotation(Number(req.params.id), tenantIdToFilter, req.user.id);
    sendResponse(res, 200, 'Quotation deleted successfully');
  } catch (error) {
    next(error);
  }
};
