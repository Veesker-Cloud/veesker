<script lang="ts">
  let version = $state("0.0.1-bootstrap");
</script>

<svelte:head>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="anonymous" />
  <link
    href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;700&family=Inter:wght@400;500&display=swap"
    rel="stylesheet"
  />
</svelte:head>

<main>
  <div class="brand">
    <svg width="56" height="56" viewBox="0 0 28 28" aria-hidden="true">
      <circle cx="4" cy="4" r="2" fill="rgba(179,62,31,0.4)" />
      <circle cx="14" cy="4" r="2" fill="rgba(179,62,31,0.4)" />
      <circle cx="24" cy="4" r="2" fill="rgba(179,62,31,0.4)" />
      <circle cx="4" cy="14" r="2" fill="rgba(179,62,31,0.4)" />
      <circle cx="14" cy="14" r="2.8" fill="#B33E1F" />
      <circle cx="24" cy="14" r="2" fill="rgba(179,62,31,0.4)" />
      <circle cx="4" cy="24" r="2" fill="rgba(179,62,31,0.4)" />
      <circle cx="14" cy="24" r="2" fill="rgba(179,62,31,0.4)" />
      <circle cx="24" cy="24" r="2" fill="rgba(179,62,31,0.4)" />
    </svg>
    <h1>veesker</h1>
  </div>
  <p class="tagline">the studio for Oracle 23ai vector search</p>
  <p class="version">v{version}</p>
</main>

<style>
  :global(body) {
    margin: 0;
    background: #f6f1e8;
    color: #1a1612;
    font-family: "Inter", -apple-system, system-ui, sans-serif;
    -webkit-font-smoothing: antialiased;
  }
  main {
    min-height: 100vh;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    padding: 2rem;
  }
  .brand {
    display: flex;
    align-items: center;
    gap: 1.25rem;
    margin-bottom: 0.5rem;
  }
  h1 {
    font-family: "Space Grotesk", sans-serif;
    font-weight: 500;
    font-size: 96px;
    letter-spacing: 0.02em;
    margin: 0;
    line-height: 1;
  }
  .tagline {
    font-family: "Space Grotesk", sans-serif;
    font-size: 16px;
    color: rgba(26, 22, 18, 0.6);
    font-style: italic;
    margin: 0.5rem 0 0;
  }
  .version {
    margin-top: 2rem;
    font-family: "Space Grotesk", sans-serif;
    font-size: 12px;
    color: rgba(26, 22, 18, 0.4);
    letter-spacing: 0.1em;
    text-transform: uppercase;
  }
</style>
