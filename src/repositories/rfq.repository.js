import prisma from '../config/db.js';

const generateRFQNumber = async (tenantId) => {
  const count = await prisma.rFQ.count({ where: { tenantId } });
  return `RFQ-${new Date().getFullYear()}-${String(count + 1).padStart(4, '0')}`;
};

export const createRFQ = async (data) => {
  const rfqNumber = await generateRFQNumber(data.tenantId);
  return await prisma.rFQ.create({
    data: {
      ...data,
      rfqNumber
    },
    include: { vendor: true, purchaseRequest: true }
  });
};

export const findRFQById = async (id) => {
  return await prisma.rFQ.findUnique({
    where: { id },
    include: { vendor: true, purchaseRequest: { include: { items: true } } }
  });
};

export const findRFQByPRAndVendor = async (purchaseRequestId, vendorId) => {
  return await prisma.rFQ.findFirst({
    where: { purchaseRequestId, vendorId }
  });
};

export const findAllRFQs = async (tenantId, query) => {
  const { page = 1, limit = 10, search = '', status, purchaseRequestId, vendorId, clientId, userId } = query;
  const skip = (page - 1) * limit;

  const where = {
    ...(tenantId !== null && { tenantId }),
    ...(search && { rfqNumber: { contains: search } }),
    ...(status && { status }),
    ...(purchaseRequestId && { purchaseRequestId: Number(purchaseRequestId) }),
    ...(vendorId && { vendorId: Number(vendorId) })
  };

  if (clientId !== undefined || userId !== undefined) {
    const clientFilters = [];
    if (clientId && Number(clientId) !== -1) {
      clientFilters.push(
        { metadata: { path: '$.clientId', equals: Number(clientId) } },
        { metadata: { path: '$.clientId', equals: String(clientId) } }
      );
    }
    if (userId) {
      clientFilters.push(
        { metadata: { path: '$.userId', equals: Number(userId) } },
        { metadata: { path: '$.userId', equals: String(userId) } },
        { purchaseRequest: { requestedBy: Number(userId) } }
      );
    }
    if (clientFilters.length > 0) {
      where.OR = clientFilters;
    } else {
      where.id = -1;
    }
  }

  const [rfqs, total] = await Promise.all([
    prisma.rFQ.findMany({
      where,
      skip: Number(skip),
      take: Number(limit),
      orderBy: { createdAt: 'desc' },
      include: {
        vendor: { select: { companyName: true, vendorCode: true } },
        purchaseRequest: { select: { prNumber: true, title: true, requestedBy: true } }
      }
    }),
    prisma.rFQ.count({ where })
  ]);

  return { rfqs, total, page: Number(page), totalPages: Math.ceil(total / limit) };
};

export const updateRFQStatus = async (id, status, metadata) => {
  const dataToUpdate = { status };
  if (metadata !== undefined) {
    dataToUpdate.metadata = metadata;
  }
  return await prisma.rFQ.update({
    where: { id },
    data: dataToUpdate
  });
};

export const deleteRFQ = async (id) => {
  return await prisma.rFQ.delete({ where: { id } });
};
