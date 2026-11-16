import { useCallback, useEffect, useRef, useState } from 'react';

const turns = ['horizontal-forward', 'horizontal-reverse', 'vertical-forward', 'vertical-reverse'] as const;
type Turn = typeof turns[number];
type Format = 'webm' | 'mp4' | 'failed';

const asset = (name: string) => `${import.meta.env.BASE_URL}hero-videos/${name}`;
const poster = asset('poster.png');

function nextTurn(previous?: Turn): Turn {
  const choices = previous ? turns.filter((turn) => turn !== previous) : turns;
  return choices[Math.floor(Math.random() * choices.length)];
}

function hasTransparentVideoFrame(video: HTMLVideoElement): boolean {
  // Codec support alone does not establish that the browser decodes alpha.
  const canvas = document.createElement('canvas');
  canvas.width = 1;
  canvas.height = 1;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Unable to check hero video transparency');
  context.drawImage(video, 0, 0, 1, 1, 0, 0, 1, 1);
  return context.getImageData(0, 0, 1, 1).data[3] < 16;
}

type PlayerProps = {
  turn: Turn;
  onEnded: () => void;
  onFailure: (error: unknown) => void;
};

function WebmPlayer({ turn, onEnded, onFailure }: PlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const failureReported = useRef(false);
  const [visible, setVisible] = useState(false);
  const reportFailure = useCallback((error: unknown) => {
    if (failureReported.current) return;
    if (document.visibilityState !== 'visible' && error instanceof DOMException && error.name === 'AbortError') return;
    failureReported.current = true;
    onFailure(error);
  }, [onFailure]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    let active = true;
    video.play().catch((error: unknown) => {
      if (active) reportFailure(error);
    });
    return () => {
      active = false;
      video.pause();
    };
  }, [reportFailure]);

  return (
    <video
      ref={videoRef}
      className={`brand-video${visible ? ' is-visible' : ''}`}
      src={asset(`${turn}.webm`)}
      poster={poster}
      muted
      playsInline
      autoPlay
      preload="auto"
      onPlaying={(event) => {
        try {
          if (!hasTransparentVideoFrame(event.currentTarget)) {
            throw new Error('The browser cannot display transparent WebM video');
          }
          setVisible(true);
        } catch (error) {
          reportFailure(error);
        }
      }}
      onError={(event) => reportFailure(event.currentTarget.error ?? new Error('WebM video failed to load'))}
      onEnded={onEnded}
    />
  );
}

function createPackedAlphaRenderer(video: HTMLVideoElement, canvas: HTMLCanvasElement) {
  const context = canvas.getContext('webgl', { alpha: true, premultipliedAlpha: false });
  if (!context) throw new Error('WebGL is unavailable for the MP4 hero video');
  const gl = context;

  function compileShader(type: number, source: string): WebGLShader {
    const shader = gl.createShader(type);
    if (!shader) throw new Error('Unable to create the hero video shader');
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const message = gl.getShaderInfoLog(shader);
      gl.deleteShader(shader);
      throw new Error(`Unable to compile the hero video shader: ${message}`);
    }
    return shader;
  }

  // The MP4 packs colour and its alpha mask into the left and right halves.
  const vertex = compileShader(gl.VERTEX_SHADER, 'attribute vec2 p; varying vec2 uv; void main(){ uv=(p+1.0)*0.5; gl_Position=vec4(p,0.0,1.0); }');
  const fragment = compileShader(gl.FRAGMENT_SHADER, 'precision mediump float; varying vec2 uv; uniform sampler2D tex; void main(){ vec3 c=texture2D(tex,vec2(uv.x*0.5,uv.y)).rgb; float a=texture2D(tex,vec2(0.5+uv.x*0.5,uv.y)).r; gl_FragColor=vec4(c,a); }');
  const program = gl.createProgram();
  if (!program) throw new Error('Unable to create the hero video program');
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error(`Unable to link the hero video program: ${gl.getProgramInfoLog(program)}`);
  }
  gl.useProgram(program);

  const buffer = gl.createBuffer();
  const texture = gl.createTexture();
  if (!buffer || !texture) throw new Error('Unable to create hero video graphics resources');
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  const position = gl.getAttribLocation(program, 'p');
  if (position < 0) throw new Error('Unable to locate the hero video vertex attribute');
  gl.enableVertexAttribArray(position);
  gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);

  return {
    draw() {
      if (gl.isContextLost()) throw new Error('The hero video graphics context was lost');
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, video);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      const error = gl.getError();
      if (error !== gl.NO_ERROR) throw new Error(`Unable to render the hero video: WebGL error ${error}`);
    },
    dispose() {
      gl.deleteTexture(texture);
      gl.deleteBuffer(buffer);
      gl.deleteProgram(program);
      gl.deleteShader(vertex);
      gl.deleteShader(fragment);
    },
  };
}

function Mp4Player({ turn, onEnded, onFailure }: PlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const failureReported = useRef(false);
  const [visible, setVisible] = useState(false);
  const reportFailure = useCallback((error: unknown) => {
    if (failureReported.current) return;
    if (document.visibilityState !== 'visible' && error instanceof DOMException && error.name === 'AbortError') return;
    failureReported.current = true;
    onFailure(error);
  }, [onFailure]);

  useEffect(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;

    let active = true;
    let hasDrawn = false;
    let cancelFrame = () => {};
    let renderer: ReturnType<typeof createPackedAlphaRenderer>;
    try {
      renderer = createPackedAlphaRenderer(video, canvas);
    } catch (error) {
      reportFailure(error);
      return;
    }

    const renderFrame = () => {
      if (!active || video.paused || video.ended) return;
      try {
        renderer.draw();
        if (!hasDrawn) {
          hasDrawn = true;
          setVisible(true);
        }
      } catch (error) {
        reportFailure(error);
        return;
      }
      if ('requestVideoFrameCallback' in video) {
        const id = video.requestVideoFrameCallback(renderFrame);
        cancelFrame = () => video.cancelVideoFrameCallback(id);
      } else {
        const id = requestAnimationFrame(renderFrame);
        cancelFrame = () => cancelAnimationFrame(id);
      }
    };
    const onPlaying = () => {
      cancelFrame();
      renderFrame();
    };
    const onContextLost = (event: Event) => {
      event.preventDefault();
      reportFailure(new Error('The hero video graphics context was lost'));
    };
    video.addEventListener('playing', onPlaying);
    canvas.addEventListener('webglcontextlost', onContextLost);
    video.play().then(() => {
      if (active && !video.paused) onPlaying();
    }).catch((error: unknown) => {
      if (active) reportFailure(error);
    });

    return () => {
      active = false;
      cancelFrame();
      video.removeEventListener('playing', onPlaying);
      canvas.removeEventListener('webglcontextlost', onContextLost);
      video.pause();
      renderer.dispose();
    };
  }, [reportFailure]);

  return (
    <>
      <video
        ref={videoRef}
        className="brand-video-source"
        src={asset(`${turn}.mp4`)}
        muted
        playsInline
        autoPlay
        preload="auto"
        onError={(event) => reportFailure(event.currentTarget.error ?? new Error('MP4 video failed to load'))}
        onEnded={onEnded}
      />
      <canvas ref={canvasRef} className={`brand-video${visible ? ' is-visible' : ''}`} width="960" height="432" />
    </>
  );
}

export default function BrandHero() {
  const [turn, setTurn] = useState<Turn>(() => nextTurn());
  const [format, setFormat] = useState<Format>('webm');
  const [reducedMotion, setReducedMotion] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const [pageVisible, setPageVisible] = useState(() => document.visibilityState === 'visible');

  useEffect(() => {
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onChange = (event: MediaQueryListEvent) => setReducedMotion(event.matches);
    preference.addEventListener('change', onChange);
    return () => preference.removeEventListener('change', onChange);
  }, []);

  useEffect(() => {
    const onVisibilityChange = () => setPageVisible(document.visibilityState === 'visible');
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => document.removeEventListener('visibilitychange', onVisibilityChange);
  }, []);

  const onEnded = useCallback(() => setTurn((previous) => nextTurn(previous)), []);
  const onWebmFailure = useCallback((error: unknown) => {
    console.warn('Unable to play the transparent WebM hero:', error);
    if (error instanceof DOMException && error.name === 'NotAllowedError') {
      setFormat('failed');
    } else {
      setFormat((current) => current === 'webm' ? 'mp4' : current);
    }
  }, []);
  const onMp4Failure = useCallback((error: unknown) => {
    console.error('Unable to play the MP4 hero:', error);
    setFormat('failed');
  }, []);

  return (
    <div className="brand-media">
      {pageVisible && !reducedMotion && format === 'webm' && (
        <WebmPlayer key={turn} turn={turn} onEnded={onEnded} onFailure={onWebmFailure} />
      )}
      {pageVisible && !reducedMotion && format === 'mp4' && (
        <Mp4Player key={turn} turn={turn} onEnded={onEnded} onFailure={onMp4Failure} />
      )}
      <img className="brand-poster" src={poster} alt="" />
    </div>
  );
}
