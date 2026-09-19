export default function Home() {
  return (
    <main style={{ fontFamily: 'ui-sans-serif, system-ui', padding: '2rem', lineHeight: 1.6 }}>
      <h1>widget-api</h1>
      <p>
        API-only deployment. Every route lives under <code>/api</code> and requires an
        <code> Authorization: Bearer &lt;token&gt;</code> header from Neon Auth, except
        <code> GET /api/users/:id/rank</code>, which is public.
      </p>
      <p>
        See <code>README.md</code> for the endpoint table and <code>AUTH-PLAN.md</code> for the
        Neon + Vercel + Cursor setup steps.
      </p>
    </main>
  );
}
