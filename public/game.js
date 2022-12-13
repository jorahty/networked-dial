const { useState, useRef, useEffect, Body } = React;

ReactDOM.createRoot(document.getElementById('root')).render(<App/>);

// `socket` is global variable so that `socket` can
// be accessed anywhere much like `fetch`
const socket = io();

function App() {
  return (
    <div>
      <MainCanvas />
      <Controls />
    </div>
  );
}

function MainCanvas() {
  const containerRef = useRef();

  useEffect(() => {
    const container = containerRef.current;
    renderToCanvas(container);
  }, []);

  return (
    <div ref={containerRef} />
  );
}

function renderToCanvas(container) {
  const { Engine, Render, Composite, Common,
    Bodies, Body, Vertices, Vector, Bounds } = Matter;

  // shape definitions
  const shapes = {
    "player": "0 0 0 75 30 75 30 0",
    "ball": "37 0 46.826 1.178 55.566 4.639 63.170 10.164 69.162 17.407 73.165 25.912 74.926 35.145 74.336 44.527 71.431 53.467 66.394 61.403 59.542 67.838 51.305 72.367 42.200 74.704 32.800 74.704 23.695 72.367 15.458 67.838 8.606 61.403 3.569 53.467 0.664 44.527 0.074 35.145 1.835 25.912 5.838 17.407 11.829 10.164 19.434 4.639 28.174 1.178",
    "terrain": "1740 997 1595 1142 442 1142 297 997 297 841 118 841 118 605 297 605 297 165 1008 165 1008 1 1 1 1 1377 2008 1377 2008 1 1028 1 1028 165 1740 165 1740 605 1918 605 1918 841 1740 841"
  };

  // provide concave decomposition support library
  Common.setDecomp(decomp);

  // create engine and world
  const engine = Engine.create();
  const { world } = engine;

  // create renderer / canvas / viewport
  const render = Render.create({
    element: container,
    engine: engine,
    options: {
      width: 800,
      height: 850,
      hasBounds: true,
    },
  });

  // add terrain
  Composite.add(world,
    Bodies.fromVertices(0, 0,
      Vertices.fromPath(shapes['terrain']), {
        isStatic: true,
      }
    )
  );

  // create composite for dynamic bodies managed by server
  const dynamic = Composite.create();
  Composite.add(world, dynamic);

  // add one or many body(s) to world
  // render each body according to given info
  socket.on('add', object => {
    const info = [].concat(object);
    for (const { id, shape, position, angle } of info) {
      Composite.add(dynamic,
        Bodies.fromVertices(position.x, position.y,
          Vertices.fromPath(shapes[shape]),
          { id, angle: angle ? angle : 0 }
        )
      );
    }
  });

  // remove one or many body(s) from world
  socket.on('remove', object => {
    const ids = [].concat(object);
    for (const id of ids)
      Composite.remove(dynamic, dynamic.bodies.find(body => body.id === id));
  });

  let myId;
  socket.on('id', id => myId = id);

  // update position and rotation of dynamic bodies,
  // move camera, and render next frame
  socket.on('update', gamestate => {
    if (document.hidden) return;
    for (const { i, x, y, a } of gamestate) {
      const body = dynamic.bodies.find(body => body.id === i);
      if (!body) continue;
      Body.setPosition(body, { x, y }); // update position
      Body.setAngle(body, a); // update angle
      if (body.id === myId) moveCameraTo(body);
    }

    Render.world(render); // render next frame
  });

  function moveCameraTo(me) {
    // compute render.postion i.e. center of viewport
    render.position = {
      x: (render.bounds.min.x + render.bounds.max.x) / 2,
      y: (render.bounds.min.y + render.bounds.max.y) / 2
    };

    // compute vector from render.position to player.position
    const delta = Vector.sub(me.position, render.position);

    if (Vector.magnitude(delta) < 1) return; // don't bother

    // on this update, only move camera 10% of the way
    Bounds.translate(render.bounds, Vector.mult(delta, 0.1));
  }
}

function Controls() {
  function handleWDown(e) {
    e.target.className = 'down';
    socket.volatile.emit('input', 'w');
  }

  function handleWUp(e) {
    e.target.className = '';
    socket.volatile.emit('input', 'W');
  }

  // use reference, not state, because
  // component should not re-render when these varaibles change
  const dialPointerId = useRef();
  const pointerInitialPosition = useRef();
  const angleCount = useRef(0);
  
  function handleDialDown(e) {
    dialPointerId.current = e.pointerId;
    pointerInitialPosition.current = e.clientY;
    socket.volatile.emit('input', 'd');
  }
  
  function handlePointerMove(e) {
    if (e.pointerId === dialPointerId.current) {
      angleCount.current++;
      const displacement = e.clientY - pointerInitialPosition.current;
      const angle = Math.round(displacement * 0.01 * 100) / 100
      dial.style.backgroundPositionY = `${displacement * 1.15}%`;
      if ( angleCount.current % 1 !== 0) return; // this reduces the send rate
      socket.volatile.emit('input', 'a', angle);
    }
  }

  function handlePointerUp(e) {
    if (e.pointerId === dialPointerId.current) {
      dialPointerId.current = null;
    }
  }

  useEffect(() => {
    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
    };
  }, []);

  return (
    <div id="controlsContainer">
      <button
        id="dial"
        onPointerDown={handleDialDown}
      >
        rotate
      </button>
      <button
        id="wButton"
        onPointerDown={handleWDown}
        onPointerUp={handleWUp}
      >
        translate
      </button>
    </div>
  );
}
