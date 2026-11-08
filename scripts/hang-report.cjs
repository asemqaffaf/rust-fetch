// Preload for diagnosing a Node.js process that does not exit (used by .github/workflows/windows.yml, #15).
// If the process is still alive after 90 seconds, print what keeps it alive and exit with code 3.
// The timer is unref'd, so it never keeps a healthy process running.
setTimeout(() => {
  const handles = process.getActiveResourcesInfo();
  console.error(`hang-report: pid ${process.pid} still running after 90 s; active resources:`, JSON.stringify(handles));
  process.exit(3);
}, 90_000).unref();
