import "server-only";

import { AuditEventService, ReportExportService } from "../../application";
import {
  SupabaseAuditEventAppender,
  SystemAuditClock,
} from "../../infrastructure/audit";
import {
  PdfReportExportRenderer,
  XlsxReportExportRenderer,
} from "../../infrastructure/report-export";
import { createDailySalesReportService } from "../daily-sales-report/server";
import { createInventoryProductionExpenseReportService } from "../inventory-production-expense-report/server";
import { createOperationalPerformanceReportService } from "../operational-performance-report/server";
import { createPaymentReportService } from "../payment-report/server";
import { createSupabaseAdminClient } from "../supabase/admin";

export function createReportExportService() {
  const client = createSupabaseAdminClient();

  return new ReportExportService(
    createDailySalesReportService(),
    createOperationalPerformanceReportService(),
    createPaymentReportService(),
    createInventoryProductionExpenseReportService(),
    Object.freeze({
      pdf: new PdfReportExportRenderer(),
      xlsx: new XlsxReportExportRenderer(),
    }),
    new AuditEventService(
      new SupabaseAuditEventAppender(client),
      new SystemAuditClock(),
    ),
  );
}
