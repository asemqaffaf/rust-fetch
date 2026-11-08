// Preload for diagnosing Node.js processes that do not exit (used by .github/workflows/windows.yml, #15).
// Every 60 seconds a process is still alive, it prints its script and what keeps it alive. It never exits
// the process, so a legitimately slow test is not cut off; the job's own timeout does that. The timer is
// unref'd, so it never keeps a healthy process running.
const started = Date.now();
setInterval(() => {
  const seconds = Math.round((Date.now() - started) / 1000);
  console.error(`hang-report: pid ${process.pid} ${process.argv[1] ?? ''} still running after ${seconds} s; active resources: ${JSON.stringify(process.getActiveResourcesInfo())}`);
}, 60_000).unref();
