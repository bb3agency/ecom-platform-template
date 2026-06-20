import {
  CreateShipmentInput,
  CreateShipmentResult,
  DeliveryRateInput,
  DeliveryRateResult,
  ServiceabilityResult,
  ShippingProviderAdapter,
  TrackShipmentResult
} from '@common/interfaces/shipping-provider.interface';
import { AppError } from '@common/errors/app-error';
import { ERROR_CODES } from '@common/errors/error-codes';

const NOOP_MSG = 'No-op shipping provider is enabled; live shipping actions are disabled';

export class NoopShippingAdapter implements ShippingProviderAdapter {
  async createShipment(_input: CreateShipmentInput): Promise<CreateShipmentResult> {
    throw new AppError(ERROR_CODES.INTERNAL_ERROR, NOOP_MSG, 503);
  }

  async trackShipment(_awbNumber: string): Promise<TrackShipmentResult> {
    throw new AppError(ERROR_CODES.INTERNAL_ERROR, NOOP_MSG, 503);
  }

  async cancelShipment(_awbNumber: string): Promise<{ cancelled: boolean; providerPayload: Record<string, unknown> }> {
    throw new AppError(ERROR_CODES.INTERNAL_ERROR, NOOP_MSG, 503);
  }

  async checkServiceability(pincode: string, _originPincode?: string): Promise<ServiceabilityResult> {
    return { pincode, serviceable: true, providerPayload: { reason: 'noop-mock' } };
  }

  async calculateDeliveryRate(_input: DeliveryRateInput): Promise<DeliveryRateResult> {
    return { shippingChargePaise: 0, estimatedDays: 3, providerPayload: { reason: 'noop-mock' } };
  }
}
