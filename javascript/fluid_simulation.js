window.marbling = function () {

    var marb_canvas = document.getElementById("main-canvas");
    var gl = GL.create(marb_canvas, { preserveDrawingBuffer: true }); // create a new webgl context (lightgl) --  http://evanw.github.io/lightgl.js/docs/main.html
    console.log(gl.keys);

    // Set canvas dimensions
    gl.canvas.width = marb_canvas.offsetWidth;
    gl.canvas.height = marb_canvas.offsetHeight;

    var WIDTH = marb_canvas.offsetWidth;
    var HEIGHT = marb_canvas.offsetHeight;

    var swap = null;

    // option values
    var options = {
        animate: true,
        advect: true,
        density: 1.0,
        timestep: 144.0,
        splosch_radius: 1,
        splosch_color: [145, 1.0, 1.0, 0.0],
        splosch_multiple: false,
        splosch_count: 1,
        splosch_spacing: 0.1,
        velocity_splosch: false,
        random_amount: 5,
        random_direction: true,
        random_color: false,
    }

    // Set viewport, x & y are 0 (lower left corner)
    gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);

    // mesh covering the canvas
    var mesh_data = {
        vertices: [[-1, 1], [1, 1], [-1, -1], [1, -1]],
        coords: [[0, 1], [1, 1], [0, 0], [1, 0]]
    }
    var mesh = gl.Mesh.load(mesh_data);

    // Create textures
    var velocity_tex0 = new gl.Texture(WIDTH, HEIGHT, {type: gl.FLOAT});
    var velocity_tex1 = new gl.Texture(WIDTH, HEIGHT, {type: gl.FLOAT});
    var color_tex0 = new gl.Texture(WIDTH, HEIGHT, {type: gl.FLOAT});
    var color_tex1 = new gl.Texture(WIDTH, HEIGHT, {type: gl.FLOAT});
    var div_tex0 = new gl.Texture(WIDTH, HEIGHT, {type: gl.FLOAT});
    var press_tex0 = new gl.Texture(WIDTH, HEIGHT, {type: gl.FLOAT});
    var press_tex1 = new gl.Texture(WIDTH, HEIGHT, {type: gl.FLOAT});

    var getRandom = function(min, max){
        return Math.floor(Math.random() * (max-min) + min);
    }

    // Shaders GLSL -- https://webglfundamentals.org/webgl/lessons/webgl-shaders-and-glsl.html
    // http://developer.download.nvidia.com/books/HTML/gpugems/gpugems_ch38.html

    var vertex = '\
        varying vec2 xy;   \
        void main() {   \
            xy = gl_TexCoord.xy;  \
            gl_Position = gl_Vertex;  \
        }';

    var textureShader = new gl.Shader(vertex, '\
            uniform sampler2D tex; \
            varying vec2 xy; \
            void main() { \
            \
                gl_FragColor = texture2D(tex, xy); \
            } \
        ');

    var sploschShader = new gl.Shader(vertex, '\
      uniform vec4 change; \
      uniform vec2 center; \
      uniform float radius; \
      uniform sampler2D tex; \
      \
      varying vec2 xy; \
      \
      void main() { \
        float dx = center.x - xy.x; \
        float dy = center.y - xy.y; \
        vec4 cur = texture2D(tex, xy); \
        gl_FragColor = cur + change * exp(-(dx * dx + dy * dy) / radius); \
      } \
    ');

    var advectionShader = new gl.Shader(vertex, '\
      uniform float timestep; \
      uniform sampler2D tex; \
      uniform sampler2D velocity_tex; \
      varying vec2 xy; \
      \
      void main() { \
        vec2 u = texture2D(velocity_tex, xy).xy; \
        \
        vec2 pastCoord = fract(xy - (0.5 * timestep * u)); \
        gl_FragColor = texture2D(tex, pastCoord); \
      } \
    ');

    var divergenceShader = new gl.Shader(vertex, '\
      uniform float timestep; \
      uniform float density; \
      uniform float dist; \
      uniform sampler2D vel_tex; \
      \
      varying vec2 xy; \
      \
      vec2 u(vec2 coord) { \
        return texture2D(vel_tex, fract(coord)).xy; \
      } \
      \
      void main() { \
        gl_FragColor = vec4((-2.0 * dist * density / timestep) * ( \
          (u(xy + vec2(dist, 0)).x - \
           u(xy - vec2(dist, 0)).x) \
          + \
          (u(xy + vec2(0, dist)).y - \
           u(xy - vec2(0, dist)).y) \
        ), 0.0, 0.0, 1.0); \
      } \
    ');

    var pressureShader = new gl.Shader(vertex, '\
      uniform float dist;  \
      uniform sampler2D div_tex; \
      uniform sampler2D press_tex; \
      \
      varying vec2 xy; \
      \
      float divergence(vec2 coord) { \
        return texture2D(div_tex, fract(coord)).x; \
      } \
      \
      float pressure(vec2 coord) { \
        return texture2D(press_tex, fract(coord)).x; \
      } \
      \
      void main() { \
        gl_FragColor = vec4(0.25 * ( \
          divergence(xy) \
          + pressure(xy + vec2(2.0 * dist, 0.0)) \
          + pressure(xy - vec2(2.0 * dist, 0.0)) \
          + pressure(xy + vec2(0.0, 2.0 * dist)) \
          + pressure(xy - vec2(0.0, 2.0 * dist)) \
        ), 0.0, 0.0, 1.0); \
      } \
    ');

    var substractShader = new gl.Shader(vertex, '\
      uniform float timestep; \
      uniform float density; \
      uniform float dist; \
      uniform sampler2D vel_tex; \
      uniform sampler2D press_tex; \
      \
      varying vec2 xy; \
      \
      float p(vec2 coord) { \
        return texture2D(press_tex, fract(coord)).x; \
      } \
      \
      void main() { \
        vec2 u_a = texture2D(vel_tex, xy).xy; \
        \
        float diff_p_x = (p(xy + vec2(dist, 0.0)) - \
                          p(xy - vec2(dist, 0.0))); \
        float u_x = u_a.x - timestep/(2.0 * density * dist) * diff_p_x; \
        \
        float diff_p_y = (p(xy + vec2(0.0, dist)) - \
                          p(xy - vec2(0.0, dist))); \
        float u_y = u_a.y - timestep/(2.0 * density * dist) * diff_p_y; \
        \
        gl_FragColor = vec4(u_x, u_y, 0.0, 0.0); \
      } \
    ');

    var drawTexture = function (tex) {
        tex.bind(0);
        textureShader.uniforms({
            tex: 0
        });
        textureShader.draw(mesh, gl.TRIANGLE_STRIP)
    };

    var setColorShader = function (r, g, b, a) {
        var colorShader = new gl.Shader(vertex, '\
            varying vec2 xy; \
            void main() { \
                float x = 2.0 * xy.x - 1.0; \
                float y = 2.0 * xy.y - 1.0; \
                gl_FragColor = vec4(' + [r, g, b, a].join(',') + '); \
            } \
        ');

        return function () {
            colorShader.draw(mesh, gl.TRIANGLE_STRIP);
        };
    }

    var advect = function (tex, velocity) {
        tex.bind(0);
        velocity.bind(1);

        advectionShader.uniforms({
            timestep: 1 / options.timestep,
            tex: 0,
            velocity_tex: 1
        });
        advectionShader.draw(mesh, gl.TRIANGLE_STRIP);
    };

    var splosch = (function (tex, change, center, radius) {
        tex.bind(0);
        sploschShader.uniforms({
            change: change,
            center: center,
            radius: radius,
            tex: 0
        });
        sploschShader.draw(mesh, gl.TRIANGLE_STRIP);
    });

    var divergence = (function (velocity_tex) {
        velocity_tex.bind(0);
        divergenceShader.uniforms({
            vel_tex: 0,
            density: options.density,
            dist: 0.5 / WIDTH,
            timestep: 1 / options.timestep
        });
        divergenceShader.draw(mesh, gl.TRIANGLE_STRIP);
    });

    var pressure = (function () {
        return function (div_tex, press_tex) {
            div_tex.bind(0);
            press_tex.bind(1);
            pressureShader.uniforms({
                div_tex: 0,
                press_tex: 1,
                dist: 1 / WIDTH
            });
            pressureShader.draw(mesh, gl.TRIANGLE_STRIP);
        };
    })();

    var subtractPressureGradient = function (vel_tex, press_tex) {
        vel_tex.bind(0);
        press_tex.bind(1);
        substractShader.uniforms({
            vel_tex: 0,
            press_tex: 1,
            dist: 1 / WIDTH,
            density: options.density,
            timestep: 1 / options.timestep,
        });
        substractShader.draw(mesh, gl.TRIANGLE_STRIP);
    };

    // GUI
    var optionsMenu = function () {
        var gui = new dat.GUI;
        gui.width = 600;

        gui.add(options, "animate").name("Animate (Shortcut: P)").listen();
        gui.add(options, "advect").name("Advect (Shortcut: A)").listen();

        gui.add(options, "density", 0.1, 2, 0.1).name("Density");
        gui.add(options, "timestep", 1, 240, 1).name("Time step");

        var splosch = gui.addFolder("Splosch Options");
        splosch.open();
        splosch.add(options, "splosch_radius", 0.0, 1.0, 0.01).name("Radius");
        splosch.addColor(options, "splosch_color").name("Color");

        splosch.add(options, "random_amount", 1, 25, 1).name("Amount of random splosches");
        splosch.add(options, "random_color").name("Random Colors");
        splosch.add(options, "random_direction").name("Random Direction");

        splosch.add({ rand: () => {
            randomSplosches(options.random_amount);
        }}, "rand").name("Create random splosches (Shortcut: S)");

        gui.add({ suspend: () => {
            suspendVelocity();
            }}, "suspend").name("Suspend movement (Shortcut: F)");

        gui.add(options, "velocity_splosch").name("Velocity splosch (no color)");

        gui.add({ reset: () => {
            restartSim();
            }}, "reset").name("Reset (Shortcut: R)");

        gui.add({ screenshot: () => {
            screenshot();
            }}, "screenshot").name("Take screenshot (Shortcut: T)");
    };

    // Eventlisteners
    document.getElementById("main-body").addEventListener("keypress", function (ev) {
        console.log(ev.key)
        if (ev.key === "p") {
            options.animate = !options.animate;
        }
        if (ev.key === "a") {
            options.advect = !options.advect;
        }
        if (ev.key === "r") {
            restartSim();
        }
        if (ev.key === "s") {
            randomSplosches(options.random_amount);
        }
        if(ev.key === "f") {
            suspendVelocity();
        }
        if(ev.key === "t"){
            screenshot();
        }
    })

    optionsMenu();

    var restartSim = function () {
        velocity_tex0.drawTo(setColorShader(0, 0, 0, 0));
        color_tex0.drawTo(setColorShader(0, 0, 0, 0));
    }

    function createDownload (fn, url) {
        var temp = document.createElement('a');
        temp.download = fn;
        temp.href = url;
        document.body.appendChild(temp);
        temp.click();
        document.body.removeChild(temp);
    }

    var screenshot = function(){
        var data = marb_canvas.toDataURL('image/png');
        createDownload("marbling_capture.png", data);
    }

    restartSim()

    gl.ondraw = function () {
        gl.clearColor(1, 1, 1, 0);
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
        drawTexture(color_tex0);
    }

    var suspendVelocity = function(){
        velocity_tex0 = new gl.Texture(WIDTH, HEIGHT, {type: gl.FLOAT});

    }

    gl.onupdate = function () {
        if (options.animate) {
            if (options.advect) {
                velocity_tex1.drawTo(function () {
                    advect(velocity_tex0, velocity_tex0);
                });
                swap = swapTexture(velocity_tex0, velocity_tex1);
                velocity_tex0 = swap.t1;
                velocity_tex1 = swap.t2;

                div_tex0.drawTo(function () {
                    divergence(velocity_tex0);
                });

                for (var i = 0; i < 10; i++) {
                    press_tex1.drawTo(function () {
                        pressure(div_tex0, press_tex0);
                    });
                    swap = swapTexture(press_tex0, press_tex1);
                    press_tex0 = swap.t1;
                    press_tex1 = swap.t2;
                }

                velocity_tex1.drawTo(function () {
                    subtractPressureGradient(velocity_tex0, press_tex0);
                });
                swap = swapTexture(velocity_tex0, velocity_tex1);
                velocity_tex0 = swap.t1;
                velocity_tex1 = swap.t2;


                color_tex1.drawTo(function () {
                    advect(color_tex0, velocity_tex0);
                });
                swap = swapTexture(color_tex0, color_tex1);
                color_tex0 = swap.t1;
                color_tex1 = swap.t2;
            }
        }
    }


    var swapTexture = function (t1, t2) {
        var temp = t1;
        t1 = t2;
        t2 = temp;

        return {t1, t2};
    }

    var dragSplosch = function (ev) {
        var color = [options.splosch_color[0] / 510, options.splosch_color[1] / 510, options.splosch_color[2] / 510]
        //var color = [0.001, 0.001, 0.001];
        if (ev.dragging) {
            console.log(ev.deltaX);
            console.log(ev.deltaY);
            console.log(ev.offsetX);
            console.log(ev.offsetY);
            if(options.velocity_splosch){
                velocitySplosch(ev.deltaX, ev.deltaY, ev.offsetX, ev.offsetY);
            }
            else{
                addSplosch(ev.deltaX, ev.deltaY, ev.offsetX, ev.offsetY, color);
            }
        }
    }

    var addSplosch = function (x, y, offsetX, offsetY, color) {

        velocity_tex1.drawTo(function () {
            splosch(
                velocity_tex0,
                [10.0 * x / WIDTH, -10.0 * y / HEIGHT, 0.0, 0.0],
                [offsetX / WIDTH, 1.0 - offsetY / HEIGHT],
                options.splosch_radius / 1000
            );
        });
        color_tex1.drawTo(function () {
            splosch(
                color_tex0,
                color.concat([0.0]),
                [offsetX / WIDTH, 1.0 - offsetY / HEIGHT],
                options.splosch_radius / 1000
            );
        });
        swap = swapTexture(velocity_tex0, velocity_tex1);
        velocity_tex0 = swap.t1;
        velocity_tex1 = swap.t2;

        swap = swapTexture(color_tex0, color_tex1);
        color_tex0 = swap.t1;
        color_tex1 = swap.t2;
    }

    var velocitySplosch = function (x, y, offsetX, offsetY){
        velocity_tex1.drawTo(function () {
            splosch(
                velocity_tex0,
                [10.0 * x / WIDTH, -10.0 * y / HEIGHT, 0.0, 0.0],
                [offsetX / WIDTH, 1.0 - offsetY / HEIGHT],
                options.splosch_radius / 1000
            );
        });

        swap = swapTexture(velocity_tex0, velocity_tex1);
        velocity_tex0 = swap.t1;
        velocity_tex1 = swap.t2;
    }

    var randomSplosches = function(amount) {
        var color = [0.0,0.0,0.0];
        var randWidth = 0;
        var randHeight = 0;
        var randXDir = 0;
        var randYDir = 0;

        for(var i = 0; i < amount; i++){
            if(options.random_color){
                var randR = getRandom(1, 255);
                var randG = getRandom(1, 255);
                var randB = getRandom(1, 255);


                color = [randR / 637.5, randG / 637.5, randB / 637.5];
                console.log(color);
            }
            else{
                color = [options.splosch_color[0] / 510, options.splosch_color[1] / 510, options.splosch_color[2] / 510]
            }

            randWidth = getRandom(50, WIDTH-50);
            randHeight = getRandom(50, HEIGHT-50);

            var length = getRandom(4, 40);

            if(options.random_direction){
                randXDir = getRandom(-4, 4);
                randYDir = getRandom(-4, 4);
            }

            for(var j = 0; j < length; j+=2){
                addSplosch(randXDir, randYDir, randWidth+j, randHeight+j, color);
            }

        }
    }

    gl.onmousedown = function (mousedownEvent) {
        dragSplosch(mousedownEvent)
        gl.onmousemove = function (mousemoveEvent) {
            dragSplosch(mousemoveEvent);
        }
    }

    gl.animate();
}