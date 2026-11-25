import * as rfqService from '../services/rfq.service.js';
import { sendResponse } from '../utils/response.js';
import { resolveTenantId } from '../utils/tenantResolver.js';
import prisma from '../config/db.js';

export const createRFQ = async (req, res, next) => {
  try {
    const isSuperAdmin = req.user.role?.name === 'SUPER_ADMIN';
    const tenantIdToUse = isSuperAdmin ? (req.body.tenantId || req.user.tenantId || 1) : (req.user.tenantId || 1);

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

    const rfqData = {
      ...req.body,
      metadata: {
        ...(req.body.metadata || {}),
        userId: req.user.id,
        clientId: clientId || null,
        clientName: req.user.name || null
      }
    };

    const rfq = await rfqService.createRFQ(rfqData, req.user.id, tenantIdToUse);
    sendResponse(res, 201, 'RFQ created successfully', rfq);
  } catch (error) {
    next(error);
  }
};

export const getRFQs = async (req, res, next) => {
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

    const result = await rfqService.getRFQs(tenantIdToFilter, req.query);
    sendResponse(res, 200, 'RFQs fetched successfully', result);
  } catch (error) {
    next(error);
  }
};

export const getRFQById = async (req, res, next) => {
  try {
    const tenantIdToFilter = resolveTenantId(req);
    const roleName = String(req.user.role?.name || req.user.role || '').toUpperCase();

    const rfq = await rfqService.getRFQById(Number(req.params.id), tenantIdToFilter);
    if (!rfq) {
      return sendResponse(res, 404, 'RFQ not found');
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
      const meta = rfq.metadata || {};
      const matchesClient = resolvedClientId && (Number(meta.clientId) === Number(resolvedClientId) || String(meta.clientId) === String(resolvedClientId));
      const matchesUser = Number(meta.userId) === Number(req.user.id) || String(meta.userId) === String(req.user.id) || Number(rfq.purchaseRequest?.requestedBy) === Number(req.user.id);
      if (!matchesClient && !matchesUser) {
        return sendResponse(res, 404, 'RFQ not found');
      }
    }

    sendResponse(res, 200, 'RFQ fetched successfully', rfq);
  } catch (error) {
    next(error);
  }
};

export const updateRFQStatus = async (req, res, next) => {
  try {
    const tenantIdToFilter = resolveTenantId(req);
    const { status, metadata } = req.body;

    const updatedRFQ = await rfqService.updateRFQStatus(Number(req.params.id), status, metadata, tenantIdToFilter, req.user.id);
    sendResponse(res, 200, 'RFQ status updated successfully', updatedRFQ);
  } catch (error) {
    next(error);
  }
};

export const deleteRFQ = async (req, res, next) => {
  try {
    const tenantIdToFilter = resolveTenantId(req);

    await rfqService.deleteRFQ(Number(req.params.id), tenantIdToFilter, req.user.id);
    sendResponse(res, 200, 'RFQ deleted successfully');
  } catch (error) {
    next(error);
  }
};
