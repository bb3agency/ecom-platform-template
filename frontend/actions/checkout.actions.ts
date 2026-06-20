"use server";

import { revalidatePath } from "next/cache";
import {
  createOrder,
  initiatePayment,
  retryPayment,
  type CreateOrderInput,
} from "@/lib/orders-api";

export type CreateCheckoutOrderInput = CreateOrderInput & {
  accessToken: string;
};

export async function createCheckoutOrderAction(input: CreateCheckoutOrderInput) {
  const { accessToken, ...orderInput } = input;
  const order = await createOrder(orderInput, accessToken);
  revalidatePath("/cart");
  revalidatePath("/checkout");
  revalidatePath("/orders");
  return order;
}

export async function initiateCheckoutPaymentAction(
  accessToken: string,
  orderId: string,
) {
  return initiatePayment(orderId, accessToken);
}

export async function retryCheckoutPaymentAction(
  accessToken: string,
  orderId: string,
) {
  return retryPayment(orderId, accessToken);
}
