// require all exports from matter-js
const Matter = require('matter-js');
for (const key in Matter) global[key] = Matter[key];

// provide concave decomposition support library
Common.setDecomp(require('poly-decomp'));

// get body shape definitions
const shapes = require('../data/shapes.json');

// init
module.exports = (http) => {
  const io = require('socket.io')(http);

  const engine = Engine.create({ enableSleeping: true });
  const world = engine.world;

  // run the engine
  const runner = Runner.create();
  Runner.run(runner, engine);

  // there are 3 catagories of bodies: known, static and dynamic.
  // clients are never informed of known bodies in any way,
  // because clients are already aware.
  // whenever a static or dynamic body is added to or removed from the world,
  // clients are informed.
  // moreover, clients are regularly updated on the position and angle of all
  // dynamic bodies that are not sleeping.
  // meanwhile, clients are never updated on the position or angle of a static
  // body, because the position and angle of a static body should never change

  // add terrain (a 'known' body)
  Composite.add(world,
    Bodies.fromVertices(0, 0,
      Vertices.fromPath(shapes['terrain']), {
        friction: 0.01, isStatic: true,
      },
    ),
  );

  // create composite for static bodies
  const static = Composite.create();
  Composite.add(world, static);

  // create composite for dynamic bodies
  const dynamic = Composite.create();
  Composite.add(world, dynamic);

  // attatch add and remove listeners
  Events.on(static, "afterAdd", afterAdd);
  Events.on(dynamic, "afterAdd", afterAdd);
  Events.on(static, "beforeRemove", beforeRemove);
  Events.on(dynamic, "beforeRemove", beforeRemove);

  // inform clients that one or many body(s) were added to world
  function afterAdd({ object }) {
    // extract minimum info needed for client to render
    const info = renderInfo(object);

    io.emit('add', info.length === 1 ? info[0] : info);
  }

  // inform clients that one or many body(s) are being removed from world
  function beforeRemove({ object }) {
    io.emit('remove',
      Array.isArray(object) ? object.map(b => b.id) : object.id
    );
  }

  // add a ball
  Composite.add(dynamic,
    Bodies.fromVertices(0, -500,
      Vertices.fromPath(shapes['ball']), {
      shape: 'ball',
      restitution: 0.9,
      mass: 0.008,
    })
  );

  io.on('connection', socket => {
    // create player
    const x = -600 + Math.random() * 1200;
    const y = -400 + Math.random() * 700;
    const player = Bodies.fromVertices(x, y,
      Vertices.fromPath(shapes['player']), {
      shape: 'player',
      controls: {},
      friction: 0.02,
      mass: 5,
    });

    socket.emit('id', player.id); // inform client of their player's id

    // privatley emit 'add' for every preexisting body
    const info = renderInfo(static.bodies.concat(dynamic.bodies));
    if (info.length > 0) socket.emit('add', info);

    Composite.add(dynamic, player); // publicly add player to world

    // listen for input
    // update control state
    socket.on('input', (code, angle) => {
      Sleeping.set(player, false);
      if (code === 'd') {
        player.initialAngle = player.angle;
        return;
      };
      if (code === 'a') {
        Body.setAngularVelocity(player, 0);
        Body.setAngle(player, player.initialAngle + angle);
        return;
      };
      const control = code.toLowerCase();
        const active = control === code;
        player.controls[control] = active;
    });

    // move player according to control state
    Events.on(engine, 'beforeUpdate', movePlayer);
    function movePlayer() {
      const { w } = player.controls;
      const f = 0.008;
      if (w) player.force = {
        x: f * Math.sin(player.angle),
        y: -f * Math.cos(player.angle)
      };
    }

    socket.on('disconnect', () => {
      Composite.remove(dynamic, player); // remove player
      Events.off(engine, 'beforeUpdate', movePlayer); // stop moving
    });
  });

  // regularly update clients on the position and
  // angle of all dynamic bodies that are not sleeping
  setInterval(() => {
    const gamestate = dynamic.bodies.flatMap(b => b.isSleeping ? [] : {
      i: b.id,
      x: Math.round(b.position.x),
      y: Math.round(b.position.y),
      a: Math.round(b.angle * 100) / 100,
    });

    io.volatile.emit('update', gamestate);
  }, 1000 / 60);
}

// extract minimum info needed for client to render
// (right now this only handles players and bags, using 
// their shape to distinguish between the two. later,
// this function needs to evolve to determine exactly
// what info is needed for rendering each body)
function renderInfo(object) {
  const objects = [].concat(object);
  return objects.map(body => {
    const bodyInfo = {
      id: body.id,
      shape: body.shape,
      angle: body.angle,
      position: body.position,
    };
    // if (body.shape === 'ball') delete bodyInfo.angle;
    return bodyInfo;
  });
}
