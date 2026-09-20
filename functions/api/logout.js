export async function onRequestPost(context) {
  try {
    const cookieHeader = context.request.headers.get("Cookie") || "";

    const match = cookieHeader.match(
      /(?:^|;\s*)boostly_session=([^;]+)/
    );

    if (match) {
      const sessionId = match[1];

      await context.env.DB
        .prepare("DELETE FROM sessions WHERE id = ?")
        .bind(sessionId)
        .run();
    }

    return new Response(null, {
      status: 303,
      headers: {
        "Location": "/login.html",
        "Set-Cookie":
          "boostly_session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0"
      }
    });

  } catch (error) {
    return new Response("Logout failed.", { status: 500 });
  }
}
