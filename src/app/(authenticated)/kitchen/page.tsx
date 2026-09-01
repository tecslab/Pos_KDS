import { requireServerPermission } from "@/lib/auth/server-authorization";
import { createKitchenQueueService } from "@/lib/kitchen-queue/server";
import { createOperatingSettingsService } from "@/lib/operating-settings/server";

import { KitchenQueueBoard } from "./kitchen-queue-board";
import type { KitchenThresholds } from "./kitchen-display";

export default async function KitchenPage() {
  await requireServerPermission("kitchen.queue.view", "/kitchen");
  const data = await loadKitchenPageData();

  if (data === null) return <KitchenLoadFailure />;

  return (
    <KitchenQueueBoard
      initialOrders={data.orders}
      thresholds={data.thresholds}
    />
  );
}

async function loadKitchenPageData() {
  try {
    const [queue, settings] = await Promise.all([
      createKitchenQueueService().read(),
      createOperatingSettingsService().list(),
    ]);

    if (!queue.ok || !settings.ok) return null;

    const thresholds: KitchenThresholds[] = settings.value.map((entry) => ({
      restaurantId: entry.restaurantId,
      warningMinutes: entry.preparationWarningMinutes,
      criticalMinutes: entry.preparationCriticalMinutes,
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

function KitchenLoadFailure() {
  return (
    <section
      role="alert"
      className="rounded-lg border border-[var(--status-critical)] bg-[var(--status-critical-bg)] p-6 text-[var(--status-critical)]"
    >
      <h1 className="text-2xl font-bold">No se pudo cargar la cocina</h1>
      <p className="mt-2">
        Actualiza la página para volver a consultar la cola y su configuración.
      </p>
    </section>
  );
}
