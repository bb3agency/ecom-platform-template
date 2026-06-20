import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import {
  assertOpsUiAccessFromRequest,
  isOpsUiBasicAuthConfigured,
  isProductionLikeRuntime,
} from "@/lib/ops-ui-auth";
import { isNoIndexPath } from "@/lib/seo";

function unauthorizedResponse() {
  return new NextResponse("Authentication required for /ops", {
    status: 401,
    headers: {
      "WWW-Authenticate": 'Basic realm="ops-console", charset="UTF-8"',
    },
  });
}

function withNoIndexHeader(request: NextRequest, response: NextResponse): NextResponse {
  if (isNoIndexPath(request.nextUrl.pathname)) {
    response.headers.set("X-Robots-Tag", "noindex, nofollow, noarchive");
  }
  return response;
}

/** Read OPS_UI_BASIC_AUTH_* at request time (not only from the production build bundle). */
export async function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname;

  if (pathname.startsWith("/ops")) {
    if (isProductionLikeRuntime() && !isOpsUiBasicAuthConfigured()) {
      return withNoIndexHeader(
        request,
        new NextResponse(
          "Ops routes are disabled until OPS_UI_BASIC_AUTH_USERNAME and OPS_UI_BASIC_AUTH_PASSWORD are configured.",
          { status: 503 },
        ),
      );
    }

    if (isOpsUiBasicAuthConfigured()) {
      try {
        assertOpsUiAccessFromRequest(request);
      } catch {
        return withNoIndexHeader(request, unauthorizedResponse());
      }
    }
  }

  return withNoIndexHeader(request, NextResponse.next());
}

export const config = {
  matcher: [
    "/admin/:path*",
    "/ops/:path*",
    "/api/:path*",
    "/login",
    "/register",
    "/forgot-password",
    "/reset-password",
    "/dashboard/:path*",
    "/orders/:path*",
    "/settings/:path*",
    "/cart",
    "/checkout/:path*",
    "/search",
  ],
};
