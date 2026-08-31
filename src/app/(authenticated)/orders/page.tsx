import { requireServerPermission } from "@/lib/auth/server-authorization";

import { OrdersWorkspace } from "./orders-workspace";

export default async function OrdersPage() {
  const context = await requireServerPermission("orders.create", "/orders");

  return (
    <OrdersWorkspace
      canCancelOrders={context.permissionCodes.includes("orders.cancel")}
    />
  );
}
