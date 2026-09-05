// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { PendingPaymentOrder } from "@/application";

vi.mock("../../../lib/supabase", () => ({
  createBrowserSupabaseClient: () => {
    throw new Error("Realtime is unavailable in this browser test.");
  },
}));
vi.mock("../../../infrastructure/realtime", () => ({
  SupabaseRealtimeSubscriber: class SupabaseRealtimeSubscriber {},
}));

import { PaymentWorkspace } from "./payment-workspace";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const restaurantId = "30000000-0000-4000-8000-000000000001";
const orderId = "41000000-0000-4000-8000-000000000001";
const basketId = "42000000-0000-4000-8000-000000000001";
const methodId = "43000000-0000-4000-8000-000000000001";
const userId = "10000000-0000-4000-8000-000000000001";
const paymentId = "44000000-0000-4000-8000-000000000001";

const paymentMethod = Object.freeze({
  id: methodId,
  restaurantId,
  code: "cash",
  name: "Efectivo",
  displayOrder: 1,
});

function paymentOrder(
  overrides: Partial<PendingPaymentOrder> = {},
): PendingPaymentOrder {
  return {
    id: orderId,
    restaurantId,
    orderNumber: "ORD-42",
    status: "DELIVERED",
    serviceLocation: {
      id: "31000000-0000-4000-8000-000000000001",
      name: "Mesa 4",
      type: "TABLE",
    },
    assignedWaiter: { id: userId, displayName: "Ana" },
    totalAmount: "10.50",
    paidAmount: "0.00",
    outstandingBalance: "10.50",
    createdAt: "2026-09-03T10:00:00.000Z",
    deliveredAt: "2026-09-03T10:20:00.000Z",
    baskets: [
      {
        id: basketId,
        status: "PENDING",
        totalAmount: "10.50",
        paidAmount: "0.00",
        outstandingBalance: "10.50",
        createdAt: "2026-09-03T10:00:00.000Z",
        paidAt: null,
        payments: [],
      },
    ],
    ...overrides,
  };
}

function response(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: vi.fn().mockResolvedValue(body),
  } as unknown as Response;
}

function renderedWorkspace() {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  return { container, root };
}

async function mount(
  root: Root,
  initialOrder = paymentOrder(),
  capabilities: Readonly<{
    canRegister?: boolean;
    canAuthorizeOverage?: boolean;
  }> = {},
) {
  await act(async () => {
    root.render(
      <PaymentWorkspace
        initialOrders={[initialOrder]}
        methods={[paymentMethod]}
        canRegister={capabilities.canRegister ?? true}
        canAuthorizeOverage={capabilities.canAuthorizeOverage ?? false}
      />,
    );
  });
}

async function changeValue(
  control: HTMLInputElement | HTMLTextAreaElement,
  value: string,
) {
  const prototype =
    control instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
  expect(setter).toBeDefined();
  await act(async () => {
    setter!.call(control, value);
    control.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function submitPayment(container: HTMLElement) {
  const balanceButton = [...container.querySelectorAll("button")].find(
    (button) => button.textContent?.includes("Usar saldo pendiente"),
  );
  const form = container.querySelector("form");
  expect(balanceButton).toBeInstanceOf(HTMLButtonElement);
  expect(form).toBeInstanceOf(HTMLFormElement);
  await act(async () => {
    balanceButton!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  await act(async () => {
    form!.dispatchEvent(
      new Event("submit", { bubbles: true, cancelable: true }),
    );
  });
}

afterEach(async () => {
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

describe("PaymentWorkspace", () => {
  it("keeps the current detail panel and its loading status available during a refresh", async () => {
    let detailRequests = 0;
    let resolveRefreshDetail: ((value: Response) => void) | undefined;
    const fetchMock = vi.fn(async (input: string) => {
      if (input === "/api/v1/payments/orders") {
        return response({ orders: [paymentOrder()] });
      }
      if (input === `/api/v1/payments/orders/${orderId}`) {
        detailRequests += 1;
        if (detailRequests === 1) return response({ order: paymentOrder() });
        return new Promise<Response>((resolve) => {
          resolveRefreshDetail = resolve;
        });
      }
      throw new Error(`Unexpected request: ${input}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const { container, root } = renderedWorkspace();

    await mount(root);
    await vi.waitFor(() => expect(detailRequests).toBe(1));
    const refresh = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "Actualizar cuentas",
    );
    expect(refresh).toBeInstanceOf(HTMLButtonElement);
    await act(async () => {
      refresh!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await vi.waitFor(() => expect(detailRequests).toBe(2));

    expect(container.textContent).toContain("ORD-42");
    expect(container.textContent).toContain("Historial de pagos");
    expect(container.textContent).toContain("Actualizando detalle…");
    expect(container.textContent).not.toContain("Selecciona una orden");
    expect(
      (container.querySelector("fieldset") as HTMLFieldSetElement).disabled,
    ).toBe(true);

    await act(async () => {
      resolveRefreshDetail?.(response({ order: paymentOrder() }));
    });
    await act(async () => root.unmount());
  });

  it("keeps a failed selected-detail error visible when a manual refresh gets a successful list", async () => {
    let detailRequests = 0;
    const fetchMock = vi.fn(async (input: string) => {
      if (input === "/api/v1/payments/orders") {
        return response({ orders: [paymentOrder()] });
      }
      if (input === `/api/v1/payments/orders/${orderId}`) {
        detailRequests += 1;
        return detailRequests === 1
          ? response({ order: paymentOrder() })
          : response({ error: { code: "INTERNAL" } }, 500);
      }
      throw new Error(`Unexpected request: ${input}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const { container, root } = renderedWorkspace();

    await mount(root);
    await vi.waitFor(() => expect(detailRequests).toBe(1));
    const refresh = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "Actualizar cuentas",
    );
    expect(refresh).toBeInstanceOf(HTMLButtonElement);
    await act(async () => {
      refresh!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await vi.waitFor(() =>
      expect(container.textContent).toContain(
        "No se pudo cargar el detalle de la cuenta. Intenta nuevamente.",
      ),
    );

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/payments/orders",
      expect.objectContaining({ method: "GET" }),
    );
    await act(async () => root.unmount());
  });

  it("submits a partial payment, displays the server-confirmed result, and refreshes the detail", async () => {
    const refreshedOrder = paymentOrder({
      paidAmount: "3.00",
      outstandingBalance: "7.50",
      baskets: [
        {
          ...paymentOrder().baskets[0],
          paidAmount: "3.00",
          outstandingBalance: "7.50",
          payments: [
            {
              id: paymentId,
              amount: "3.00",
              paymentMethodId: methodId,
              paymentMethodCode: "cash",
              paymentMethodName: "Efectivo",
              recordedBy: { id: userId, displayName: "Ana" },
              recordedAt: "2026-09-03T10:25:00.000Z",
              referenceNumber: null,
              comments: null,
            },
          ],
        },
      ],
    });
    let registered = false;
    const fetchMock = vi.fn(async (input: string, init?: RequestInit) => {
      if (input === "/api/v1/payments/orders") {
        return response({
          orders: [registered ? refreshedOrder : paymentOrder()],
        });
      }
      if (input === `/api/v1/payments/orders/${orderId}`) {
        return response({
          order: registered ? refreshedOrder : paymentOrder(),
        });
      }
      if (input === "/api/v1/payments" && init?.method === "POST") {
        registered = true;
        return response({
          payment: {
            paymentId,
            orderId,
            basketId,
            basketOutstandingBalance: "7.50",
            basketStatus: "PENDING",
            orderStatus: "DELIVERED",
          },
        });
      }
      throw new Error(`Unexpected request: ${input}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const { container, root } = renderedWorkspace();

    await mount(root);
    await submitPayment(container);
    await vi.waitFor(() =>
      expect(container.textContent).toContain(
        "Pago registrado. Saldo pendiente:",
      ),
    );
    await vi.waitFor(() => expect(container.textContent).toContain("7,50"));

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/payments",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          basketId,
          paymentMethodId: methodId,
          amount: "10.50",
        }),
      }),
    );
    await act(async () => root.unmount());
  });

  it("keeps an invalid client-side amount out of the payment API and explains the correction", async () => {
    const fetchMock = vi.fn(async (input: string) => {
      if (input === "/api/v1/payments/orders") {
        return response({ orders: [paymentOrder()] });
      }
      if (input === `/api/v1/payments/orders/${orderId}`) {
        return response({ order: paymentOrder() });
      }
      throw new Error(`Unexpected request: ${input}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const { container, root } = renderedWorkspace();

    await mount(root);
    const form = container.querySelector("form");
    expect(form).toBeInstanceOf(HTMLFormElement);
    await act(async () => {
      form!.dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true }),
      );
    });
    await vi.waitFor(() =>
      expect(container.textContent).toContain(
        "Ingresa un monto válido mayor que cero.",
      ),
    );

    expect(fetchMock).not.toHaveBeenCalledWith(
      "/api/v1/payments",
      expect.objectContaining({ method: "POST" }),
    );
    await act(async () => root.unmount());
  });

  it("retains confirmed payment success when its following account refresh fails", async () => {
    let registered = false;
    const fetchMock = vi.fn(async (input: string, init?: RequestInit) => {
      if (input === "/api/v1/payments/orders") {
        return registered
          ? response({ error: { code: "INTERNAL" } }, 500)
          : response({ orders: [paymentOrder()] });
      }
      if (input === `/api/v1/payments/orders/${orderId}`) {
        return response({ order: paymentOrder() });
      }
      if (input === "/api/v1/payments" && init?.method === "POST") {
        registered = true;
        return response({
          payment: {
            paymentId,
            orderId,
            basketId,
            basketOutstandingBalance: "7.50",
            basketStatus: "PENDING",
            orderStatus: "DELIVERED",
          },
        });
      }
      throw new Error(`Unexpected request: ${input}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const { container, root } = renderedWorkspace();

    await mount(root);
    await submitPayment(container);
    await vi.waitFor(() =>
      expect(container.textContent).toContain(
        "Pago registrado. Saldo pendiente:",
      ),
    );
    expect(container.textContent).toContain(
      "No se pudieron actualizar las cuentas. Se conserva la última información disponible.",
    );
    expect(container.textContent).not.toContain(
      "No se pudo registrar el pago. Intenta nuevamente.",
    );

    await act(async () => root.unmount());
  });

  it("keeps paid baskets selectable for immutable history while disabling payment registration", async () => {
    const paidBasket = {
      ...paymentOrder().baskets[0],
      id: "42000000-0000-4000-8000-000000000002",
      status: "PAID" as const,
      paidAmount: "10.50",
      outstandingBalance: "0.00",
      paidAt: "2026-09-03T10:25:00.000Z",
      payments: [
        {
          id: paymentId,
          amount: "10.50",
          paymentMethodId: methodId,
          paymentMethodCode: "cash",
          paymentMethodName: "Pago previo",
          recordedBy: { id: userId, displayName: "Ana" },
          recordedAt: "2026-09-03T10:25:00.000Z",
          referenceNumber: null,
          comments: null,
        },
      ],
    };
    const orderWithPaidBasket = paymentOrder({
      baskets: [...paymentOrder().baskets, paidBasket],
    });
    const fetchMock = vi.fn(async (input: string) => {
      if (input === "/api/v1/payments/orders") {
        return response({ orders: [orderWithPaidBasket] });
      }
      if (input === `/api/v1/payments/orders/${orderId}`) {
        return response({ order: orderWithPaidBasket });
      }
      throw new Error(`Unexpected request: ${input}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const { container, root } = renderedWorkspace();

    await mount(root, orderWithPaidBasket);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const paidBasketButton = [...container.querySelectorAll("button")].find(
      (button) => button.textContent?.includes("Cliente 2"),
    );
    expect(paidBasketButton).toBeInstanceOf(HTMLButtonElement);
    expect((paidBasketButton as HTMLButtonElement).disabled).toBe(false);
    await act(async () => {
      paidBasketButton!.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });
    await vi.waitFor(() =>
      expect(container.textContent).toContain("Pago previo"),
    );
    expect(
      (paidBasketButton as HTMLButtonElement).getAttribute("aria-pressed"),
    ).toBe("true");
    expect(
      (container.querySelector("fieldset") as HTMLFieldSetElement).disabled,
    ).toBe(true);
    expect(
      (
        [...container.querySelectorAll("button")].find(
          (button) => button.textContent === "Registrar pago",
        ) as HTMLButtonElement
      ).disabled,
    ).toBe(true);

    await act(async () => root.unmount());
  });

  it("blocks an overage before the API for users without authorization", async () => {
    const fetchMock = vi.fn(async (input: string) => {
      if (input === "/api/v1/payments/orders") {
        return response({ orders: [paymentOrder()] });
      }
      if (input === `/api/v1/payments/orders/${orderId}`) {
        return response({ order: paymentOrder() });
      }
      throw new Error(`Unexpected request: ${input}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const { container, root } = renderedWorkspace();

    await mount(root);
    const amount = container.querySelector<HTMLInputElement>(
      'input[name="amount"]',
    );
    const form = container.querySelector("form");
    expect(amount).toBeInstanceOf(HTMLInputElement);
    expect(form).toBeInstanceOf(HTMLFormElement);
    await changeValue(amount!, "11");
    await act(async () => {
      form!.dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true }),
      );
    });
    await vi.waitFor(() =>
      expect(container.textContent).toContain(
        "El monto no puede superar el saldo pendiente de esta cuenta.",
      ),
    );
    expect(fetchMock).not.toHaveBeenCalledWith(
      "/api/v1/payments",
      expect.objectContaining({ method: "POST" }),
    );

    await act(async () => root.unmount());
  });

  it("lets an authorized user record an overage only with a reason", async () => {
    const fetchMock = vi.fn(async (input: string, init?: RequestInit) => {
      if (input === "/api/v1/payments/orders") {
        return response({ orders: [paymentOrder()] });
      }
      if (input === `/api/v1/payments/orders/${orderId}`) {
        return response({ order: paymentOrder() });
      }
      if (input === "/api/v1/payments" && init?.method === "POST") {
        return response({
          payment: {
            paymentId,
            orderId,
            basketId,
            basketOutstandingBalance: "0.00",
            basketStatus: "PAID",
            orderStatus: "PAID",
          },
        });
      }
      throw new Error(`Unexpected request: ${input}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const { container, root } = renderedWorkspace();

    await mount(root, paymentOrder(), { canAuthorizeOverage: true });
    const amount = container.querySelector<HTMLInputElement>(
      'input[name="amount"]',
    );
    const reason = container.querySelector<HTMLTextAreaElement>(
      'textarea[name="overageReason"]',
    );
    const form = container.querySelector("form");
    expect(amount).toBeInstanceOf(HTMLInputElement);
    expect(reason).toBeInstanceOf(HTMLTextAreaElement);
    expect(form).toBeInstanceOf(HTMLFormElement);
    await changeValue(amount!, "11");
    await act(async () => {
      form!.dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true }),
      );
    });
    await vi.waitFor(() =>
      expect(container.textContent).toContain(
        "Un pago superior al saldo requiere una justificación autorizada.",
      ),
    );
    await changeValue(reason!, "Cliente entregó efectivo adicional");
    await act(async () => {
      form!.dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true }),
      );
    });
    await vi.waitFor(() =>
      expect(container.textContent).toContain(
        "Pago registrado. La orden quedó pagada.",
      ),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/payments",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          basketId,
          paymentMethodId: methodId,
          amount: "11.00",
          overageReason: "Cliente entregó efectivo adicional",
        }),
      }),
    );

    await act(async () => root.unmount());
  });

  it("shows the typed payment API error in the registration form", async () => {
    const fetchMock = vi.fn(async (input: string, init?: RequestInit) => {
      if (input === "/api/v1/payments/orders") {
        return response({ orders: [paymentOrder()] });
      }
      if (input === `/api/v1/payments/orders/${orderId}`) {
        return response({ order: paymentOrder() });
      }
      if (input === "/api/v1/payments" && init?.method === "POST") {
        return response({ error: { code: "PAYMENT_METHOD_UNAVAILABLE" } }, 409);
      }
      throw new Error(`Unexpected request: ${input}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const { container, root } = renderedWorkspace();

    await mount(root);
    await submitPayment(container);
    await vi.waitFor(() =>
      expect(container.textContent).toContain(
        "El método seleccionado ya no está disponible. Elige otro método activo.",
      ),
    );

    await act(async () => root.unmount());
  });
});
