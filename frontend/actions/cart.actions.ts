"use server";

import { revalidatePath } from "next/cache";

export async function revalidateCartAction(): Promise<void> {
  revalidatePath("/cart");
  revalidatePath("/checkout");
}
