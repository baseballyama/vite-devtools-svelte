import type { RequestHandler } from './$types';

export const GET: RequestHandler = () => {
  let i = 0;
  let timer: ReturnType<typeof setInterval> | undefined;
  const stream = new ReadableStream<string>({
    start(controller) {
      timer = setInterval(() => {
        controller.enqueue(`chunk ${++i} at ${Date.now()}\n`);
        if (i === 5) {
          clearInterval(timer);
          controller.close();
        }
      }, 200);
    },
    cancel() {
      clearInterval(timer);
    },
  });
  return new Response(stream.pipeThrough(new TextEncoderStream()), {
    headers: { 'content-type': 'text/plain; charset=utf-8' },
  });
};
