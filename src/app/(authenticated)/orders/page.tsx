import { requireServerPermission } from "@/lib/auth/server-authorization";

import { OrdersWorkspace } from "./orders-workspace";

export default async function OrdersPage() {
  await requireServerPermission("orders.create", "/orders");

  return <OrdersWorkspace />;
}
