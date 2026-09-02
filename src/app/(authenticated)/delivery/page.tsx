import { requireServerPermission } from "@/lib/auth/server-authorization";
import { createDeliveryQueueService } from "@/lib/delivery-queue/server";
import { createOperatingSettingsService } from "@/lib/operating-settings/server";

import { DeliveryQueueBoard } from "./delivery-queue-board";
import type { DeliveryThresholds } from "./delivery-display";

export default async function DeliveryPage() {
  await requireServerPermission("delivery.panel.view", "/delivery");
  const data = await loadDeliveryPageData();

  if (data === null) return <DeliveryLoadFailure />;

  return (
    <DeliveryQueueBoard
      initialOrders={data.orders}
      thresholds={data.thresholds}
    />
  );
}

async function loadDeliveryPageData() {
  try {
    const [queue, settings] = await Promise.all([
      createDeliveryQueueService().read({}),
      createOperatingSettingsService().list(),
    ]);

    if (!queue.ok || !settings.ok) return null;

    const thresholds: DeliveryThresholds[] = settings.value.map((entry) => ({
      restaurantId: entry.restaurantId,
      warningMinutes: entry.deliveryWarningMinutes,
      criticalMinutes: entry.deliveryCriticalMinutes,
    }));
    const configuredRestaurants = new Set(
      thresholds.map(({ restaurantId }) => restaurantId),
    );

    if (
      thresholds.length === 0 ||
      queue.value.some(
        (order) => !configuredRestaurants.has(order.restaurantId),
      )
    ) {
      return null;
    }

    return { orders: queue.value, thresholds };
  } catch {
    return null;
  }
}

function DeliveryLoadFailure() {
  return (
    <section
      role="alert"
      className="rounded-lg border border-[var(--status-critical)] bg-[var(--status-critical-bg)] p-6 text-[var(--status-critical)]"
    >
      <h1 className="text-2xl font-bold">No se pudo cargar entregas</h1>
      <p className="mt-2">
        Actualiza la página para volver a consultar la cola y su configuración.
      </p>
    </section>
  );
}
