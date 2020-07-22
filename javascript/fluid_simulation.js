window.marbling = function () {

    var marb_canvas = document.getElementById("main-canvas");
    var gl = GL.create(marb_canvas, {preserveDrawingBuffer: true}); // create a new webgl context (lightgl) --  http://evanw.github.io/lightgl.js/docs/main.html

    // Set canvas dimensions
    gl.canvas.width = marb_canvas.offsetWidth;
    gl.canvas.height = marb_canvas.offsetHeight;

    var WIDTH = marb_canvas.offsetWidth;
    var HEIGHT = marb_canvas.offsetHeight;

    var lastFrameTime = Date.now();

    var tWidthSize = 1.0 / WIDTH;
    var tHeightSize = 1.0 / HEIGHT;

    var swap = null;

    // option values
    var options = {
        animate: true,
        advect: true,
        advection_interpolation: true,
        pressure: true,
        vorticity: true,
        density: 1.0,
        curl: 35.0,
        timescale: 1.5,
        dissapation_factor: 0.0,
        timestep: 0.0166,
        fps: 60.0,
        splosch_radius: 0.25,
        splosch_color: [145, 1.0, 1.0, 0.0],
        splosch_multiple: false,
        splosch_count: 1,
        splosch_spacing: 0.1,
        velocity_splosch: false,
        rake: false,
        random_amount: 5,
        random_direction: true,
        random_color: false,
    }

    // rake options
    var rakeOptions = {
        rowCount: 1,
        colCount: 1,
        rowSpacing: 100,
        colSpacing: 100,
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
    var curl_tex0 = new gl.Texture(WIDTH, HEIGHT, {type: gl.FLOAT});
    var vort_tex0 = new gl.Texture(WIDTH, HEIGHT, {type: gl.FLOAT});
    var boundary = new gl.Texture(WIDTH, HEIGHT, {type: gl.FLOAT});

    var getRandom = function (min, max) {
        return Math.floor(Math.random() * (max - min) + min);
    }

    // Shaders GLSL -- https://webglfundamentals.org/webgl/lessons/webgl-shaders-and-glsl.html
    // http://developer.download.nvidia.com/books/HTML/gpugems/gpugems_ch38.html

    var vertex = '\
    \
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
      uniform vec2 coordinate; \
      uniform float radius; \
      uniform sampler2D tex; \
      \
      varying vec2 xy; \
      \
      void main() { \
        float dx = coordinate.x - xy.x; \
        float dy = coordinate.y - xy.y; \
        vec4 cur = texture2D(tex, xy); \
        gl_FragColor = cur + change * exp(-(dx * dx + dy * dy) / radius); \
      } \
    ');

    var advectionShader = new gl.Shader(vertex, '\
      uniform float timestep; \
      uniform float dissapation_factor;\
      uniform float gridWidth;\
      uniform float gridHeight;\
      uniform sampler2D tex; \
      uniform sampler2D velocity_tex; \
      \
      varying vec2 xy; \
      \
      void main() { \
        vec2 velocity = texture2D(velocity_tex, xy).xy; \
        \
        vec2 pastCoord = xy - (timestep * velocity); \
        float dissapation = 1.0 + dissapation_factor * timestep;\
        gl_FragColor = texture2D(tex, pastCoord) / dissapation; \
      } \
    ');

    var advectionInterpolationShader = new gl.Shader(vertex, '\
      uniform float timestep; \
      uniform float dissapation_factor;\
      uniform float gridWidth;\
      uniform float gridHeight;\
      uniform float timeScale;\
      uniform sampler2D tex; \
      uniform sampler2D velocity_tex; \
      \
      varying vec2 xy; \
      \
      vec4 bilinear_interpolation(sampler2D tex, vec2 xy) {\
        vec2 gridSize = vec2(1.0/gridWidth, 1.0/gridHeight);\
        vec2 vxy = xy / gridSize - 0.5; \
        \
        vec2 ixy = floor(vxy);\
        vec2 fxy = fract(vxy);\
        \
        vec4 a = texture2D(tex, (ixy + vec2(0.5, 0.5)) * gridSize);\
        vec4 b = texture2D(tex, (ixy + vec2(1.5, 0.5)) * gridSize);\
        vec4 c = texture2D(tex, (ixy + vec2(0.5, 1.5)) * gridSize);\
        vec4 d = texture2D(tex, (ixy + vec2(1.5, 1.5)) * gridSize);\
        \
        return mix(mix(a, b, fxy.x), mix(c, d, fxy.x), fxy.y);\
      }\
      \
      void main() { \
        vec2 gridSize = vec2(1.0/1667.0, 1.0/941.0);\
        vec2 u = bilinear_interpolation(velocity_tex, xy).xy; \
        \
        vec2 pastCoord = xy - (timeScale * timestep * u); \
        float dissapation = 1.0 + dissapation_factor * timestep;\
        gl_FragColor = texture2D(tex, pastCoord) / dissapation; \
      } \
    ');

    var curlShader = new gl.Shader(vertex, '\
        uniform sampler2D vel_tex;\
        uniform float gridWidth;\
        uniform float gridHeight;\
        \
        varying vec2 xy;\
        \
        void main() {\
            vec2 left = xy - vec2(gridWidth, 0.0);\
            vec2 right = xy + vec2(gridWidth, 0.0);\
            vec2 top = xy + vec2(0.0, gridHeight);\
            vec2 bottom = xy - vec2(0.0, gridHeight);\
            \
            float l = texture2D(vel_tex, left).y;\
            float r = texture2D(vel_tex, right).y;\
            float t = texture2D(vel_tex, top).x;\
            float b = texture2D(vel_tex, bottom).x;\
            \
            float vorticity = r - l - t + b;\
            gl_FragColor = vec4(0.5 * vorticity, 0.0, 0.0, 1.0);\
        }\
    ');

    var vorticityShader = new gl.Shader(vertex, '\
        uniform sampler2D curl_tex;\
        uniform sampler2D vel_tex;\
        uniform float timestep;\
        uniform float curl;\
        uniform float gridWidth;\
        uniform float gridHeight;\
        \
        varying vec2 xy;\
        \
        void main() {\
            vec2 left = xy - vec2(gridWidth, 0.0);\
            vec2 right = xy + vec2(gridWidth, 0.0);\
            vec2 top = xy + vec2(0.0, gridHeight);\
            vec2 bottom = xy - vec2(0.0, gridHeight);\
            \
            float l = texture2D(curl_tex, left).x;\
            float r = texture2D(curl_tex, right).x;\
            float t = texture2D(curl_tex, top).x;\
            float b = texture2D(curl_tex, bottom).x;\
            \
            float curr = texture2D(curl_tex, xy).x;\
            \
            vec2 force = vec2(abs(t) - abs(b), abs(r) - abs(l));\
            force /= length(force) + 0.00001;\
            force *= (curl) * curr;\
            force.y *= -1.0;\
            \
            vec2 vel = texture2D(vel_tex, xy).xy;\
            vel += (force * timestep)*2.5;\
            vel = min(max(vel, -1000.0), 10000.0);\
            gl_FragColor = vec4(vel, 0.0, 1.0);\
        }\
    ')

    var divergenceShader = new gl.Shader(vertex, '\
      uniform float timestep; \
      uniform float density; \
      uniform float gridWidth; \
      uniform float gridHeight; \
      uniform sampler2D vel_tex; \
      \
      varying vec2 xy; \
      \
      vec2 u(vec2 coord) { \
        return texture2D(vel_tex, coord).xy; \
      } \
      \
      void main() { \
      \
        vec2 left = xy - vec2(gridWidth, 0.0);\
        vec2 right = xy + vec2(gridWidth, 0.0);\
        vec2 top = xy + vec2(0.0, gridWidth);\
        vec2 bottom = xy - vec2(0.0, gridWidth);\
        \
        float l = texture2D(vel_tex, left).x;\
        float r = texture2D(vel_tex, right).x;\
        float t = texture2D(vel_tex, top).y;\
        float b = texture2D(vel_tex, bottom).y;\
        \
        vec2 curr = texture2D(vel_tex, xy).xy;\
        \
        if(left.x < 0.0){ l = -curr.x; }\
        if(right.x > 1.0){ r = -curr.x; }\
        if(top.y > 1.0){ t = -curr.y; }\
        if(bottom.y < 0.0){ b = -curr.y; }\
        \
        \
        float divergence = 0.5 * (r - l + t - b);\
        gl_FragColor = vec4((-2.0 * gridWidth * density / timestep) * ( \
          (r - l) \
          + \
          (t - b) \
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
        return texture2D(div_tex, coord).x; \
      } \
      \
      float pressure(vec2 coord) { \
        return texture2D(press_tex, coord).x; \
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
        return texture2D(press_tex, coord).x; \
      } \
      \
      void main() { \
        vec2 curr = texture2D(vel_tex, xy).xy; \
        \
        float diff_p_x = (p(xy + vec2(dist, 0.0)) - \
                          p(xy - vec2(dist, 0.0))); \
        float x = curr.x - timestep/(1.0 * density * dist) * diff_p_x; \
        \
        float diff_p_y = (p(xy + vec2(0.0, dist)) - \
                          p(xy - vec2(0.0, dist))); \
        float y = curr.y - timestep/(1.0 * density * dist) * diff_p_y; \
        \
        gl_FragColor = vec4(x, y, 0.0, 0.0); \
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
                gl_FragColor = vec4(' + [r, g, b, a].join(',') + '); \
            } \
        ');

        return function () {
            colorShader.draw(mesh, gl.TRIANGLE_STRIP);
        };
    }

    var advect = function (tex, velocity, interpolation) {
        tex.bind(0);
        velocity.bind(1);
        if(interpolation){
            advectionInterpolationShader.uniforms({
                timestep: options.timestep,
                dissapation_factor: options.dissapation_factor,
                gridWidth: WIDTH,
                gridHeight: HEIGHT,
                timeScale: options.timescale,
                tex: 0,
                velocity_tex: 1
            });
            advectionInterpolationShader.draw(mesh, gl.TRIANGLE_STRIP);
        }
        else{
            advectionShader.uniforms({
                timestep: options.timestep,
                dissapation_factor: options.dissapation_factor,
                gridWidth: WIDTH,
                gridHeight: HEIGHT,
                tex: 0,
                velocity_tex: 1
            });
            advectionShader.draw(mesh, gl.TRIANGLE_STRIP);
        }
    };

    var curl = (function(vel_tex){
        vel_tex.bind(0);
        curlShader.uniforms({
            vel_tex: 0,
            gridWidth: 1 / WIDTH,
            gridHeight: 1 / HEIGHT,
        });
        curlShader.draw(mesh, gl.TRIANGLE_STRIP);
    });

    var vorticity = (function(curl_tex, vel_tex){
        curl_tex.bind(0);
        vel_tex.bind(1);
        vorticityShader.uniforms({
            curl_tex: 0,
            vel_tex: 1,
            curl: options.curl,
            gridWidth: 1 / WIDTH,
            gridHeight: 1 / HEIGHT,
            timestep: options.timestep,
        });
        vorticityShader.draw(mesh, gl.TRIANGLE_STRIP);
    });

    var splosch = (function (tex, change, coordinate, radius) {
        tex.bind(0);
        sploschShader.uniforms({
            change: change,
            coordinate: coordinate,
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
            gridWidth: 1 / WIDTH,
            gridHeight: 1 / HEIGHT,
            timestep: options.timestep
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
            timestep: options.timestep,
        });
        substractShader.draw(mesh, gl.TRIANGLE_STRIP);
    };

    // GUI
    var optionsMenu = function () {
        var gui = new dat.GUI;
        gui.width = 600;

        gui.add(options, "animate").name("Animate (Shortcut: P)").listen();
        gui.add(options, "advect").name("Advect (Shortcut: A)").listen();
        gui.add(options, "advection_interpolation").name("Advection Interpolation").listen();
        gui.add(options, "pressure").name("Pressure (Shortcut: Y)").listen();
        gui.add(options, "vorticity").name("Vorticity").listen();

        gui.add(options, "density", 0.1, 2, 0.1).name("Density");
        gui.add(options, "dissapation_factor", 0.0, 1.0, 0.1).name("Dissapation");
        gui.add(options, "curl", 0.0, 40.0, 1).name("Vorticity");
        gui.add(options, "timescale", 0.25, 2.0, 0.25).name("timescale");

        //gui.add(options, "timestep", 1, 240, 1).name("Time step");

        var splosch = gui.addFolder("Splosch Options");
        splosch.open();
        splosch.add(options, "splosch_radius", 0.0, 1.0, 0.01).name("Radius");
        splosch.addColor(options, "splosch_color").name("Color");

        splosch.add(options, "random_amount", 1, 25, 1).name("Amount of random splosches");
        splosch.add(options, "random_color").name("Random Colors");
        splosch.add(options, "random_direction").name("Random Direction");

        splosch.add({
            rand: () => {
                randomSplosches(options.random_amount);
            }
        }, "rand").name("Create random splosches (Shortcut: S)");

        gui.add({
            suspend: () => {
                suspendVelocity();
            }
        }, "suspend").name("Suspend movement (Shortcut: F)");

        gui.add(options, "velocity_splosch").name("Velocity splosch (no color)");

        gui.add({
            reset: () => {
                restartSim();
            }
        }, "reset").name("Reset (Shortcut: R)");

        gui.add({
            screenshot: () => {
                screenshot();
            }
        }, "screenshot").name("Take screenshot (Shortcut: T)");


        gui.add(options, "rake").name("Enable Rake");

        var rake = gui.addFolder("Rake Options");
        rake.add(rakeOptions, "rowCount", 1, 7, 1).name("Rake rows");
        rake.add(rakeOptions, "colCount", 1, 7, 1).name("Rake columns");
        rake.add(rakeOptions, "rowSpacing", 50, 500, 25).name("Rake row spacing");
        rake.add(rakeOptions, "colSpacing", 50, 500, 25).name("Rake column spacing");

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
        if (ev.key === "y") {
            options.pressure = !options.pressure;
        }
        if (ev.key === "r") {
            restartSim();
        }
        if (ev.key === "s") {
            randomSplosches(options.random_amount);
        }
        if (ev.key === "f") {
            suspendVelocity();
        }
        if (ev.key === "t") {
            screenshot();
        }
    })

    optionsMenu();

    var restartSim = function () {
        velocity_tex0.drawTo(setColorShader(0, 0, 0, 1));
        color_tex0.drawTo(setColorShader(0.0, 0.0, 0.0, 0));
    }

    var calculateStep = function (){
        var currTime = Date.now();
        var timestep = (currTime - lastFrameTime) / 1000;
        timestep = Math.min(timestep, 1/options.fps);
        lastFrameTime = currTime;
        return timestep;
    }

    function createDownload(fn, url) {
        var temp = document.createElement('a');
        temp.download = fn;
        temp.href = url;
        document.body.appendChild(temp);
        temp.click();
        document.body.removeChild(temp);
    }

    var screenshot = function () {
        var data = marb_canvas.toDataURL('image/png');
        createDownload("marbling_capture.png", data);
    }

    restartSim()

    gl.ondraw = function () {
        gl.clearColor(1, 1, 1, 0);
        gl.clear(gl.COLOR_BUFFER_BIT, gl.DEPTH_BUFFER_BIT);
        drawTexture(color_tex0);
    }

    var suspendVelocity = function () {
        velocity_tex0 = new gl.Texture(WIDTH, HEIGHT, {type: gl.FLOAT});
    }

    gl.onupdate = function () {
        options.timestep = calculateStep();
        if (options.animate) {
            if (options.advect) {
                velocity_tex1.drawTo(function () {
                    advect(velocity_tex0, velocity_tex0, options.advection_interpolation);
                });
                swap = swapTexture(velocity_tex0, velocity_tex1);
                velocity_tex0 = swap.t1;
                velocity_tex1 = swap.t2;

                if(options.pressure){
                    if(options.vorticity){
                        console.log("reached");
                        curl_tex0.drawTo(function(){
                            curl(velocity_tex0);
                        });

                        vort_tex0.drawTo(function(){
                            vorticity(curl_tex0, velocity_tex0);
                        });
                    }
                    else{
                        vort_tex0 = velocity_tex0;
                    }

                    div_tex0.drawTo(function () {
                        divergence(vort_tex0);
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
                }

                color_tex1.drawTo(function () {
                    advect(color_tex0, velocity_tex1, options.advection_interpolation);
                });
                swap = swapTexture(velocity_tex0, velocity_tex1);
                velocity_tex0 = swap.t1;
                velocity_tex1 = swap.t2;
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


    // Splosch functions
    var dragSplosch = function (ev) {
        //var color = [0.001, 0.001, 0.001];
        if (ev.dragging) {
            /*console.log(ev.deltaX);
            console.log(ev.deltaY);
            console.log(ev.offsetX);
            console.log(ev.offsetY);*/
            if (options.velocity_splosch) {
                velocitySplosch(ev.deltaX, ev.deltaY, ev.offsetX, ev.offsetY);
            } else if (options.rake) {
                rake(rakeOptions.rowCount, rakeOptions.colCount, rakeOptions.rowSpacing, rakeOptions.colSpacing, ev);
            } else {
                addSplosch(ev.deltaX, ev.deltaY, ev.offsetX, ev.offsetY);
            }
        }
    }

    function random_rgba() {
        var o = Math.round, r = Math.random, s = 255;
        return  [o(r()*s)/510, o(r()*s)/510, o(r()*s)/510];
    }

    var addSplosch = function (x, y, offsetX, offsetY) {
        if (options.random_color) {
            var randR = getRandom(1, 255);
            var randG = getRandom(1, 255);
            var randB = getRandom(1, 255);


            color = random_rgba();
            console.log(color);
        } else {
            color = [options.splosch_color[0] / 510, options.splosch_color[1] / 510, options.splosch_color[2] / 510]
        }
        velocity_tex1.drawTo(function () {
            splosch(
                velocity_tex0,
                [10.0 * x / WIDTH, -10.0 * y / HEIGHT, 0.0, 0.0],
                [offsetX / WIDTH, 1.0 - offsetY / HEIGHT],
                options.splosch_radius / 500
            );
        });
        color_tex1.drawTo(function () {
            splosch(
                color_tex0,
                color.concat([1]),
                [offsetX / WIDTH, 1.0 - offsetY / HEIGHT],
                options.splosch_radius / 500
            );
        });
        swap = swapTexture(velocity_tex0, velocity_tex1);
        velocity_tex0 = swap.t1;
        velocity_tex1 = swap.t2;

        swap = swapTexture(color_tex0, color_tex1);
        color_tex0 = swap.t1;
        color_tex1 = swap.t2;
    }

    var velocitySplosch = function (x, y, offsetX, offsetY) {
        velocity_tex1.drawTo(function () {
            splosch(
                velocity_tex0,
                [10.0 * x / WIDTH, -10.0 * y / HEIGHT, 0.0, 0.0],
                [offsetX / WIDTH, 1.0 - offsetY / HEIGHT],
                options.splosch_radius / 500
            );
        });

        swap = swapTexture(velocity_tex0, velocity_tex1);
        velocity_tex0 = swap.t1;
        velocity_tex1 = swap.t2;
    }

    var randomSplosches = function (amount) {
        var randWidth = 0;
        var randHeight = 0;
        var randXDir = 0;
        var randYDir = 0;

        for (var i = 0; i < amount; i++) {
            randWidth = getRandom(50, WIDTH - 50);
            randHeight = getRandom(50, HEIGHT - 50);

            var length = getRandom(4, 40);

            if (options.random_direction) {
                randXDir = getRandom(-4, 4);
                randYDir = getRandom(-4, 4);
            }

            for (var j = 0; j < length; j += 2) {
                addSplosch(randXDir, randYDir, randWidth + j, randHeight + j);
            }

        }
    }

    // Rake & Comb utils
    var rake = function (rowCount, colCount, rowSpacing, colSpacing, event) {
        var rowPerSide = 0;
        var colPerSide = 0;

        if(rowCount == 1){
            rowPerSide = rowCount;
        } else {
            rowPerSide = (rowCount - 1) / 2;
        }

        if (colCount == 1) {
            colPerSide = colCount;
        } else {
            colPerSide = (colCount - 1) / 2;
        }

        if(rowCount == 1){
            if(colCount == 1){
                addSplosch(event.deltaX, event.deltaY, event.offsetX, event.offsetY);
            } else {
                for (var j = -colPerSide; j <= colPerSide; j++) {
                    if ((colCount % 2) == 0 && j == 0) { continue }
                    addSplosch(event.deltaX, event.deltaY, event.offsetX + (j * colSpacing), event.offsetY);
                }
            }

        }
        else{
            for (var i = -rowPerSide; i <= rowPerSide; i++) {
                if ((rowCount % 2) == 0 && i == 0) { continue }
                if(colCount == 1){
                    addSplosch(event.deltaX, event.deltaY, event.offsetX, event.offsetY + (i * rowSpacing));
                }
                else{
                    for (var j = -colPerSide; j <= colPerSide; j++) {
                        if ((colCount % 2) == 0 && j == 0) { continue }
                        addSplosch(event.deltaX, event.deltaY, event.offsetX + (j * colSpacing), event.offsetY + (i * rowSpacing));
                    }
                }
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