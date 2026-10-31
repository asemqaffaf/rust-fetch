// Same fault expectations on every adapter, with explicit platform differences.
export const reliabilityCases = [
  {
    id: 'fault-sse-reconnect-storm',
    area: 'Reliability and observability',
    title: 'Sixteen SSE streams recover from repeated immediate closes with jittered backoff',
    run: `async (rf, ctx) => {
      const streams = [], delays = [];
      let timer;
      try {
        const work = Promise.all(Array.from({ length: 16 }, async (_, i) => {
          const stream = new WasmClient({ retries: 0 }).events(ctx.a + '/fault/sse-reconnect-storm?id=' + ctx.id('sse-storm-' + i), {
            reconnect: { maxRetries: 3, initialDelayMs: 10, maxDelayMs: 10 }, end: '[DONE]',
            onReconnect: ({ delayMs }) => delays.push(delayMs),
          });
          streams.push(stream);
          const messages = [];
          for await (const event of stream) messages.push(event.data);
          return messages.join(',') === 'recovered';
        }));
        const completed = await Promise.race([work, new Promise((_, reject) => { timer = setTimeout(() => reject(Error('SSE reconnect storm did not recover')), 5000); })]);
        return { recovered: completed.filter(Boolean).length, reconnects: delays.length, bounded: delays.every((delay) => delay >= 5 && delay <= 10), jittered: new Set(delays).size > 1 };
      } finally { clearTimeout(timer); for (const stream of streams) stream.close(); }
    }`,
    expect: { recovered: 16, reconnects: 32, bounded: true, jittered: true },
  },
  {
    id: 'fault-websocket-reconnect-storm',
    area: 'Reliability and observability',
    title: 'Sixteen WebSockets recover from repeated immediate drops with jittered backoff',
    run: `async (rf, ctx) => {
      if (typeof WebSocket !== 'function') return { unsupported: true };
      const sockets = [], delays = [];
      let timer, recovered = 0;
      try {
        const work = Promise.all(Array.from({ length: 16 }, (_, i) => new Promise((resolve, reject) => {
          const socket = new WasmClient().websocket(ctx.websocket + 'fault/reconnect-storm?id=' + ctx.id('ws-storm-' + i), {
            reconnect: { maxRetries: 3, initialDelayMs: 10, maxDelayMs: 10 },
            onReconnect: ({ delayMs }) => delays.push(delayMs),
            onMessage: (message) => { if (message === 'recovered') { recovered++; socket.close(); resolve(); } },
          });
          sockets.push(socket);
          socket.opened.catch(reject);
        })));
        await Promise.race([work, new Promise((_, reject) => { timer = setTimeout(() => reject(Error('WebSocket reconnect storm did not recover: ' + JSON.stringify({ recovered, reconnects: delays.length, states: sockets.map((socket) => socket.state) }))), 30000); })]);
        return { recovered: sockets.length, reconnects: delays.length, bounded: delays.every((delay) => delay >= 5 && delay <= 10), jittered: new Set(delays).size > 1 };
      } finally { clearTimeout(timer); for (const socket of sockets) socket.close(); await Promise.all(sockets.map((socket) => socket.closed)); }
    }`,
    expect: { recovered: 16, reconnects: 32, bounded: true, jittered: true },
    differs: Object.fromEntries(['native', 'node:http', 'fetch()'].map((adapter) => [adapter, {
      anyOf: [{ recovered: 16, reconnects: 32, bounded: true, jittered: true }, { unsupported: true }],
      why: 'Node.js 20 requires --experimental-websocket; without it WebSocket cases are unavailable.',
    }])),
  },
  {
    "id": "fault-reset",
    "area": "Reliability and observability",
    "title": "A reset response is a typed network failure",
    "run": "async (rf,ctx) => { try { await new WasmClient({timeoutMs:1000,retries:0}).get(ctx.a+'/fault/reset'); } catch(e) { return {error:e.kind,cause:e.cause instanceof Error}; } }",
    "expect": {
      "error": "NetworkError",
      "cause": true
    }
  },
  {
    "id": "fault-truncated",
    "area": "Reliability and observability",
    "title": "A truncated response is a typed network failure",
    "run": "async (rf,ctx) => { const e=await outcome(new WasmClient({timeoutMs:1000,retries:0}).get(ctx.a+'/fault/truncated')); return {error:e.error}; }",
    "expect": {
      "error": "NetworkError"
    }
  },
  {
    "id": "fault-headers",
    "area": "Reliability and observability",
    "title": "A headers response is a typed network failure",
    "run": "async (rf,ctx) => { const e=await outcome(new WasmClient({timeoutMs:1000,retries:0}).get(ctx.a+'/fault/headers')); return e.error ? {error:e.error} : {status:e.status}; }",
    "expect": {
      "error": "NetworkError"
    },
    "differs": {
      "webkit": {
        "anyOf": [{ "status": 200 }, { "error": "NetworkError" }],
        "why": "WebKit's network stack controls header-buffer limits: macOS accepts the tested 1 MiB header, while Linux rejects it as a NetworkError. Neither limit is configurable by the JavaScript adapter."
      }
    }
  },
  {
    "id": "fault-idle",
    "area": "Reliability and observability",
    "title": "A idle connection is bounded by a timer",
    "run": "async (rf,ctx) => { const e=await outcome(new WasmClient({timeoutMs:60,retries:0}).get(ctx.a+'/fault/idle')); return {error:e.error,timeoutMs:e.timeoutMs}; }",
    "expect": {
      "error": "TimeoutError",
      "timeoutMs": 60
    }
  },
  {
    "id": "fault-half-open",
    "area": "Reliability and observability",
    "title": "A half-open connection is bounded by a timer",
    "run": "async (rf,ctx) => { const e=await outcome(new WasmClient({timeoutMs:60,retries:0}).get(ctx.a+'/fault/half-open')); return {error:e.error,timeoutMs:e.timeoutMs}; }",
    "expect": {
      "error": "TimeoutError",
      "timeoutMs": 60
    }
  },
  {
    "id": "fault-recovery",
    "area": "Reliability and observability",
    "title": "Retry-After recovery returns the successful retry",
    "run": "async (rf,ctx) => outcome(new WasmClient({retries:{maxRetries:1,initialDelayMs:1}}).get(ctx.a+'/fault/recovery?id='+ctx.id('recovery')))",
    "expect": {
      "status": 200,
      "body": {
        "recovered": true
      }
    }
  },
  {
    "id": "fault-cancel-burst",
    "area": "Reliability and observability",
    "title": "A burst of 64 cancellations settles every request",
    "run": "async (rf,ctx) => {\n       const c=new WasmClient({timeoutMs:1000});\n       const controllers=Array.from({length:64},()=>new AbortController());\n       const pending=controllers.map(a=>outcome(c.get(ctx.a+'/fault/half-open',{signal:a.signal})));\n       controllers.forEach(a=>a.abort());\n       const errors=await Promise.all(pending);\n       return {cancelled:errors.filter(e=>e.error==='CancelledError').length};\n     }",
    "expect": {
      "cancelled": 64
    }
  },
  {
    "id": "fault-load-limiter",
    "area": "Reliability and observability",
    "title": "A burst queued in the core completes without losing requests",
    "run": "async (rf,ctx) => {\n       const c=new WasmClient({maxConcurrent:3,metrics:true});\n       await Promise.all(Array.from({length:24},()=>c.get(ctx.a+'/fault/slow')));\n       return c.stats().requests;\n     }",
    "expect": {
      "started": 24,
      "completed": 24,
      "failed": 0,
      "active": 0
    }
  },
  {
    "id": "observe-timings",
    "area": "Reliability and observability",
    "title": "Opt-in attempt timings and lifecycle hooks work on every adapter",
    "run": "async (rf,ctx) => {\n       let starts=0,ends=0;\n       const c=new WasmClient({timings:true,onRequestStart:()=>starts++,onRequestEnd:()=>ends++});\n       const r=await c.get(ctx.a+'/fault/slow');\n       return {starts,ends,attempts:r.timings.attempts.length,bounded:r.timings.totalMs>=15&&r.timings.totalMs<1000};\n     }",
    "expect": {
      "starts": 1,
      "ends": 1,
      "attempts": 1,
      "bounded": true
    }
  },
  {
    "id": "observe-error-context",
    "area": "Reliability and observability",
    "title": "Errors identify the final request and retry count",
    "run": "async (rf,ctx) => {\n       try {await new WasmClient({retries:{maxRetries:1,initialDelayMs:1}}).get(ctx.a+'/status?code=503');}\n       catch(e){return {method:e.method,attempts:e.attempts,url:e.url===ctx.a+'/status?code=503'};}\n     }",
    "expect": {
      "method": "GET",
      "attempts": 2,
      "url": true
    }
  },
  {
    "id": "observe-trace-origins",
    "area": "Reliability and observability",
    "title": "Trace context reaches only allowlisted origins",
    "run": "async (rf,ctx) => {\n       const parent='00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01';\n       const c=new WasmClient({propagateTrace:true,traceOrigins:[ctx.a],traceContext:()=>({traceparent:parent,tracestate:'vendor=value'})});\n       const a=await c.get(ctx.a+'/fault/trace'),b=await c.get(ctx.b+'/fault/trace');\n       return {allowed:a.body.traceparent===parent&&a.body.tracestate==='vendor=value',denied:b.body.traceparent===null};\n     }",
    "expect": {
      "allowed": true,
      "denied": true
    }
  },
  {
    "id": "fault-sse-silence",
    "area": "Reliability and observability",
    "title": "A silent SSE connection ends with a typed idle timeout",
    "run": "async(rf,ctx)=>{\n  const events=new WasmClient({idleTimeoutMs:40,timeoutMs:1000}).events(ctx.a+'/fault/sse-idle',{reconnect:false});\n  await events.opened;\n  try { await events.next(); return {error:null}; } catch(e) { return {error:e.kind,phase:e.phase,attempts:e.attempts}; }\n }",
    "expect": {
      "error": "TimeoutError",
      "phase": "idle",
      "attempts": 1
    }
  },
  {
    "id": "fault-websocket-silence",
    "area": "Reliability and observability",
    "title": "A silent WebSocket closes with a typed idle timeout",
    "run": "async(rf,ctx)=>{\n  if(typeof WebSocket!=='function') return {unsupported:true};\n  const errors=[];\n  const ws=new WasmClient().websocket(ctx.websocket,{idleTimeoutMs:40,onError:e=>errors.push(e)});\n  await ws.opened; await ws.closed;\n  return {error:errors[0]?.kind,phase:errors[0]?.phase};\n }",
    "expect": {
      "error": "TimeoutError",
      "phase": "idle"
    },
    "differs": {
      "native": {
        "anyOf": [
          {
            "error": "TimeoutError",
            "phase": "idle"
          },
          {
            "unsupported": true
          }
        ],
        "why": "Node.js 20 requires --experimental-websocket; without it WebSocket cases are unavailable."
      },
      "node:http": {
        "anyOf": [
          {
            "error": "TimeoutError",
            "phase": "idle"
          },
          {
            "unsupported": true
          }
        ],
        "why": "Node.js 20 requires --experimental-websocket; without it WebSocket cases are unavailable."
      },
      "fetch()": {
        "anyOf": [
          {
            "error": "TimeoutError",
            "phase": "idle"
          },
          {
            "unsupported": true
          }
        ],
        "why": "Node.js 20 requires --experimental-websocket; without it WebSocket cases are unavailable."
      }
    }
  },
  {
    "id": "observe-redirect-error-url",
    "area": "Reliability and observability",
    "title": "Ordinary errors retain the final URL after a redirect",
    "run": "async(rf,ctx)=>{\n  try { await new WasmClient().get(ctx.a+'/fault/redirect-error'); }\n  catch(e) { return {method:e.method,attempts:e.attempts,final:e.url===ctx.a+'/status?code=503'}; }\n }",
    "expect": {
      "method": "GET",
      "attempts": 1,
      "final": true
    }
  },
  {
    "id": "observe-upload-transport",
    "area": "Reliability and observability",
    "title": "Upload-progress attempts report the transport actually used",
    "run": "async(rf,ctx)=>{\n  const r=await new WasmClient({timings:true}).post(ctx.a+'/echo',{body:'payload',onUploadProgress(){}});\n  return {transport:r.timings.attempts[0].transport,attempts:r.timings.attempts.length};\n }",
    "expect": {
      "transport": "node:http",
      "attempts": 1
    },
    "differs": {
      "fetch()": {
        "expect": {
          "transport": "fetch",
          "attempts": 1
        },
        "why": "Upload progress uses XMLHttpRequest in browsers, fetch in a runtime without XHR, and node:http in Node (including when the native addon is installed)."
      },
      "chromium": {
        "expect": {
          "transport": "XMLHttpRequest",
          "attempts": 1
        },
        "why": "Upload progress uses XMLHttpRequest in browsers, fetch in a runtime without XHR, and node:http in Node (including when the native addon is installed)."
      },
      "firefox": {
        "expect": {
          "transport": "XMLHttpRequest",
          "attempts": 1
        },
        "why": "Upload progress uses XMLHttpRequest in browsers, fetch in a runtime without XHR, and node:http in Node (including when the native addon is installed)."
      },
      "webkit": {
        "expect": {
          "transport": "XMLHttpRequest",
          "attempts": 1
        },
        "why": "Upload progress uses XMLHttpRequest in browsers, fetch in a runtime without XHR, and node:http in Node (including when the native addon is installed)."
      }
    }
  }
];
