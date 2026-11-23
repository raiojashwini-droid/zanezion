import * as vehicleRepo from '../repositories/vehicle.repository.js';
import AppError from '../utils/AppError.js';

const isDateExpired = (dateStr) => {
  if (!dateStr) return false;
  const fullStr = String(dateStr).includes('T') ? dateStr : `${dateStr}T23:59:59.999`;
  const exp = new Date(fullStr);
  return !isNaN(exp.getTime()) && exp.getTime() < Date.now();
};

export const createVehicle = async (data, tenantId) => {
  if (isDateExpired(data.registrationExpiry)) {
    data.status = 'Inactive';
  }
  return await vehicleRepo.createVehicle({ ...data, tenantId: tenantId ? Number(tenantId) : null });
};

export const getVehicles = async (tenantId) => {
  const vehicles = await vehicleRepo.findAllVehicles(tenantId ? Number(tenantId) : null);
  return vehicles.map(v => {
    if (isDateExpired(v.registrationExpiry)) {
      return { ...v, status: 'Inactive' };
    }
    return v;
  });
};

export const getVehicleById = async (id) => {
  const vehicle = await vehicleRepo.findVehicleById(Number(id));
  if (!vehicle) throw new AppError('Vehicle not found', 404);
  return vehicle;
};

export const updateVehicle = async (id, data) => {
  await getVehicleById(id);
  if (isDateExpired(data.registrationExpiry)) {
    data.status = 'Inactive';
  }
  return await vehicleRepo.updateVehicle(Number(id), data);
};

export const deleteVehicle = async (id) => {
  await getVehicleById(id);
  await vehicleRepo.deleteVehicle(Number(id));
  return true;
};
