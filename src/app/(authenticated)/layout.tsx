import type { ReactNode } from "react";
import { redirect } from "next/navigation";

import { buildNavigation } from "@/application";
import { ApplicationShell } from "@/components/application-shell";
import { isBusinessError } from "@/domain";
import { requireServerAuthorizationContext } from "@/lib/auth/server-authorization";

import { signOut } from "../login/actions";

type AuthenticatedLayoutProps = Readonly<{
  children: ReactNode;
}>;

export default async function AuthenticatedLayout({
  children,
}: AuthenticatedLayoutProps) {
  let context;

  try {
    context = await requireServerAuthorizationContext("/");
  } catch (error) {
    if (isBusinessError(error) && error.code === "UNAUTHORIZED") {
      redirect("/access-denied");
    }

    throw error;
  }

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
