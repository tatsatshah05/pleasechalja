export default function Home() {
  return (
    <div style={{ fontFamily: "system-ui", padding: "4rem 2rem", maxWidth: "600px", margin: "0 auto" }}>
      <h1>WebSimplify API</h1>
      <p>This is the backend for the WebSimplify Chrome extension.</p>
      <p>
        <strong>Endpoint:</strong>{" "}
        <code>POST /api/rewrite</code>
      </p>
    </div>
  );
}
