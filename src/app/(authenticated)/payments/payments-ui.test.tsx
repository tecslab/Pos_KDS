import { readFile } from "node:fs/promises";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const dependencies = vi.hoisted(() => ({
  authorize: vi.fn(),
  createPaymentQueryService: vi.fn(),
  createPaymentMethodAdministrationService: vi.fn(),
  listOrders: vi.fn(),
  listMethods: vi.fn(),
}));

vi.mock("@/lib/auth/server-authorization", () => ({
  requireServerPermission: dependencies.authorize,
}));
vi.mock("@/lib/payment-queries/server", () => ({
  createPaymentQueryService: dependencies.createPaymentQueryService,
}));
vi.mock("@/lib/payment-method-administration/server", () => ({
  createPaymentMethodAdministrationService:
    dependencies.createPaymentMethodAdministrationService,
}));

import PaymentsPage from "./page";

const restaurantId = "30000000-0000-4000-8000-000000000001";
const order = Object.freeze({
  id: "41000000-0000-4000-8000-000000000001",
  restaurantId,
  orderNumber: "ORD-42",
  status: "DELIVERED" as const,
  serviceLocation: {
    id: "31000000-0000-4000-8000-000000000001",
    name: "Mesa 4",
    type: "TABLE",
  },
  assignedWaiter: {
    id: "10000000-0000-4000-8000-000000000001",
    displayName: "Ana",
  },
  totalAmount: "18.50",
  paidAmount: "8.00",
  outstandingBalance: "10.50",
  createdAt: "2026-09-03T10:00:00.000Z",
  deliveredAt: "2026-09-03T10:20:00.000Z",
  baskets: [
    {
      id: "42000000-0000-4000-8000-000000000001",
      status: "PENDING" as const,
      totalAmount: "18.50",
      paidAmount: "8.00",
      outstandingBalance: "10.50",
      createdAt: "2026-09-03T10:00:00.000Z",
      paidAt: null,
      payments: [],
    },
  ],
});

beforeEach(() => {
  dependencies.authorize.mockReset().mockResolvedValue({
    userId: "10000000-0000-4000-8000-000000000001",
    permissionCodes: ["payments.view", "payments.register"],
  });
  dependencies.createPaymentQueryService
    .mockReset()
    .mockReturnValue({ list: dependencies.listOrders });
  dependencies.createPaymentMethodAdministrationService
    .mockReset()
    .mockReturnValue({ list: dependencies.listMethods });
  dependencies.listOrders
    .mockReset()
    .mockResolvedValue({ ok: true, value: [order] });
  dependencies.listMethods.mockReset().mockResolvedValue({
    ok: true,
    value: [
      {
        id: "43000000-0000-4000-8000-000000000001",
        restaurantId,
        restaurantName: "Carnales",
        code: "cash",
        name: "Efectivo",
        displayOrder: 1,
        isActive: true,
        isBankTransfer: false,
        bankName: "",
        accountHolder: "",
        accountNumber: "",
        receiptHeader: "",
        receiptFooter: "",
      },
      {
        id: "43000000-0000-4000-8000-000000000002",
        restaurantId,
        restaurantName: "Carnales",
        code: "old",
        name: "Inactivo",
        displayOrder: 2,
        isActive: false,
        isBankTransfer: false,
        bankName: "",
        accountHolder: "",
        accountNumber: "",
        receiptHeader: "",
        receiptFooter: "",
      },
    ],
  });
});

describe("split and partial payment UI", () => {
  it("authorizes before reading orders and safely exposes only active method labels", async () => {
    const markup = renderToStaticMarkup(await PaymentsPage());

    expect(dependencies.authorize).toHaveBeenCalledWith(
      "payments.view",
      "/payments",
    );
    expect(dependencies.listOrders).toHaveBeenCalledWith({});
    expect(markup).toContain("ORD-42");
    expect(markup).toContain("Mesa 4");
    expect(markup).toContain("Historial de pagos");
    expect(markup).toContain("Efectivo");
    expect(markup).not.toContain("Inactivo");
    expect(markup).not.toContain("accountNumber");
  });

  it("does not compose data services after authorization denial", async () => {
    dependencies.authorize.mockRejectedValue(new Error("unauthorized"));

    await expect(PaymentsPage()).rejects.toThrow("unauthorized");
    expect(dependencies.createPaymentQueryService).not.toHaveBeenCalled();
    expect(
      dependencies.createPaymentMethodAdministrationService,
    ).not.toHaveBeenCalled();
  });

  it("exposes the overage-reason control only to an authorized payment registrar", async () => {
    expect(renderToStaticMarkup(await PaymentsPage())).not.toContain(
      "Justificación de sobrepago",
    );
    dependencies.authorize.mockResolvedValue({
      userId: "10000000-0000-4000-8000-000000000001",
      permissionCodes: [
        "payments.view",
        "payments.register",
        "payments.overage.authorize",
      ],
    });

    expect(renderToStaticMarkup(await PaymentsPage())).toContain(
      "Justificación de sobrepago",
    );
  });

  it("uses authorized APIs, accessible touch controls, response-driven completion, and realtime refetch", async () => {
    const [workspace, display] = await Promise.all([
      readFile(new URL("./payment-workspace.tsx", import.meta.url), "utf8"),
      readFile(new URL("./payment-display.ts", import.meta.url), "utf8"),
    ]);

    expect(workspace).toContain('aria-label="Órdenes con pagos pendientes"');
    expect(workspace).toContain('aria-label="Detalle y registro de pago"');
    expect(workspace).toContain('aria-label="Historial inmutable de pagos"');
    expect(workspace).toContain('aria-label="Registrar pago parcial"');
    expect(workspace).toContain('method: "GET"');
    expect(workspace).toContain('fetch("/api/v1/payments/orders"');
    expect(workspace).toContain("fetch(`/api/v1/payments/orders/${orderId}`");
    expect(workspace).toContain('fetch("/api/v1/payments"');
    expect(workspace).toContain('method: "POST"');
    expect(workspace).toContain("parsePaymentRegistrationResult");
    expect(workspace).toContain("paymentRegistrationErrorMessage");
    expect(workspace).toContain("canRegisterSelectedPayment");
    expect(workspace).toContain("canAuthorizeOverage");
    expect(workspace).toContain("overageReason");
    expect(workspace).toContain("await refreshOrders()");
    expect(workspace).toContain("await loadDetail(current)");
    expect(workspace).toContain("min-h-12");
    expect(workspace).toContain(
      "2xl:grid-cols-[minmax(18rem,0.8fr)_minmax(26rem,1.2fr)]",
    );
    expect(workspace).toContain(
      "2xl:grid-cols-[minmax(13rem,0.75fr)_minmax(18rem,1.25fr)]",
    );
    expect(workspace).not.toMatch(/\.from\(|\.rpc\(/);
    expect(display).toContain('topic: "payments"');
    expect(display).toContain('"order.created"');
    expect(display).toContain('"delivery.status.updated"');
    expect(display).toContain('"payment.completed"');
    expect(display).toContain("5_000");
  });
});
