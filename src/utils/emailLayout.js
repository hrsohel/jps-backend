const PORTAL_URL = process.env.FRONTEND_URL || "http://localhost:5173";
const LOGO_URL = `${PORTAL_URL}/assets/JPS%20Core-2.png`;

export function emailWrap(bodyHtml) {
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:Arial,Helvetica,sans-serif">
  <div style="max-width:620px;margin:32px auto;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,.10)">

    <!-- Header -->
    <div style="background:linear-gradient(135deg,#06174a 0%,#0749B3 100%);padding:22px 32px">
      <img src="${LOGO_URL}" alt="JPS Core" style="height:46px;display:block;filter:brightness(0) invert(1)" />
    </div>

    <!-- Body -->
    <div style="padding:32px 32px 24px">
      ${bodyHtml}
      <div style="margin-top:28px">
        <a href="${PORTAL_URL}" style="display:inline-block;background:#22A9E0;color:#ffffff;padding:13px 26px;text-decoration:none;border-radius:8px;font-weight:700;font-size:14px">Access Your Portal</a>
      </div>
    </div>

    <!-- Footer -->
    <div style="background:#f8fafc;padding:18px 32px;border-top:1px solid #e2e8f0">
      <p style="margin:0 0 3px;font-size:13px;font-weight:700;color:#0749B3">JPS Core</p>
      <p style="margin:0;font-size:11px;color:#94a3b8">Solutions for Growing Businesses &nbsp;&bull;&nbsp; Building. Marketing. Growing.</p>
    </div>

  </div>
</body>
</html>`;
}

export { PORTAL_URL, LOGO_URL };
