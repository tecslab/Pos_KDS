import { requireServerPermission } from "@/lib/auth/server-authorization";

import { OrderDraftComposer } from "./order-draft-composer";

export default async function OrdersPage() {
  await requireServerPermission("orders.create", "/orders");

  return <OrderDraftComposer />;
}
