export async function onRequest(context) {
  const url = new URL(context.request.url);

  // Dashboard ko protect karo
  if (url.pathname === "/dashboard.html") {
    const cookieHeader = context.request.headers.get("Cookie") || "";

    const match = cookieHeader.match(
      /(?:^|;\s*)boostly_session=([^;]+)/
    );

    const sessionId = match ? match[1] : null;

    if (!sessionId) {
      return Response.redirect(
        new URL("/login.html", context.request.url),
        302
      );
    }

    const session = await context.env.DB
      .prepare(`
        SELECT id, user_id
        FROM sessions
        WHERE id = ?
        AND expires_at > datetime('now')
      `)
      .bind(sessionId)
      .first();

    if (!session) {
      return new Response(null, {
        status: 302,
        headers: {
          "Location": "/login.html",
          "Set-Cookie":
            "boostly_session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0"
        }
      });
    }
  }

  return context.next();
}
