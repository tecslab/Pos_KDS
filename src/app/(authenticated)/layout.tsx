import type { ReactNode } from "react";

import { buildNavigation } from "@/application";
import { ApplicationShell } from "@/components/application-shell";
import { requireServerAuthorizationContext } from "@/lib/auth/server-authorization";

import { signOut } from "../login/actions";

type AuthenticatedLayoutProps = Readonly<{
  children: ReactNode;
}>;

export default async function AuthenticatedLayout({
  children,
}: AuthenticatedLayoutProps) {
  const context = await requireServerAuthorizationContext("/");
  const navigation = buildNavigation(context.permissionCodes);

  return (
    <ApplicationShell
      context={context}
      navigation={navigation}
      signOutAction={signOut}
    >
      {children}
    </ApplicationShell>
  );
}
