window.marbling = function () {

    var marb_canvas = document.getElementById("main-canvas");
    var gl = GL.create(marb_canvas, {preserveDrawingBuffer: true}); // create a new webgl context (lightgl) --  http://evanw.github.io/lightgl.js/docs/main.html

    // Set canvas dimensions
    gl.canvas.width = marb_canvas.offsetWidth;
    gl.canvas.height = marb_canvas.offsetHeight;

    marb_canvas.oncontextmenu = () => false;

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
        fps: 144.0,
        jaccobi_iterations: 20,
        splosch_radius: 0.25,
        splosch_color: [145, 1.0, 1.0, 0.0],
        splosch_multiple: false,
        splosch_count: 1,
        splosch_spacing: 0.1,
        velocity_splosch: false,
        rake: false,
        tapping: false,
        tapAmount: 5,
        brushHeight: 250,
        random_amount: 5,
        random_direction: true,
        random_color: false,
        test_constraint: 0.0,
        draw: true,
        select: false,
        selectdrag: false,
        selectend: false,
        x1Constraint: 0.0,
        y1Constraint: 0.0,
        x2Constraint: 1.0,
        y2Constraint: 1.0,
        freeze: false,
        test: false,
        key: -1,
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
        float diff_x = coordinate.x - xy.x; \
        float diff_y = coordinate.y - xy.y; \
        vec4 curr = texture2D(tex, xy); \
        gl_FragColor = curr + change * exp(-(diff_x * diff_x + diff_y * diff_y) / radius); \
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
        if(xy.x > 0.001 && xy.x < 0.999 && xy.y > 0.001 && xy.y < 0.999){\
        \
        vec2 velocity = texture2D(velocity_tex, xy).xy; \
        \
        vec2 pastCoord = xy - (timestep * velocity); \
        float dissapation = 1.0 + dissapation_factor * timestep;\
        gl_FragColor = texture2D(tex, pastCoord) / dissapation; \
      }} \
    ');

    var advectionInterpolationShader = new gl.Shader(vertex, '\
      uniform float timestep; \
      uniform float dissapation_factor;\
      uniform float gridWidth;\
      uniform float gridHeight;\
      uniform float timeScale;\
      uniform float x1Constraint;\
      uniform float x2Constraint;\
      uniform float y1Constraint;\
      uniform float y2Constraint;\
      uniform bool freeze;\
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
      if(xy.x > 0.001 && xy.x < 0.999 && xy.y > 0.001 && xy.y < 0.999){\
        if(freeze == true){\
        if(xy.x > x1Constraint && xy.x < x2Constraint && xy.y > y2Constraint && xy.y < y1Constraint){\
        gl_FragColor = texture2D(tex, xy);\
        } \
        else {\
            vec2 gridSize = vec2(1.0/gridWidth, 1.0/gridHeight);\
            vec2 u = bilinear_interpolation(velocity_tex, xy).xy;\
            vec2 pastCoord = xy - (timeScale * timestep * u);\
            float dissapation = 1.0 + dissapation_factor * timestep;\
            gl_FragColor = texture2D(tex, pastCoord) / dissapation;\
        }\
        }\
        else{\
        vec2 gridSize = vec2(1.0/gridWidth, 1.0/gridHeight);\
        vec2 u = bilinear_interpolation(velocity_tex, xy).xy; \
        \
        vec2 pastCoord = xy - (timeScale * timestep * u); \
        float dissapation = 1.0 + dissapation_factor * timestep;\
        gl_FragColor = texture2D(tex, pastCoord) / dissapation;\
        }\
      }} \
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
            float currentVel = texture2D(curl_tex, xy).x;\
            \
            vec2 force = vec2(abs(t) - abs(b), abs(r) - abs(l));\
            force = force / (length(force) + 0.00001);\
            force = force * (curl * currentVel);\
            force.y = force.y * -1.0;\
            \
            vec2 vorticityVel = texture2D(vel_tex, xy).xy;\
            vorticityVel += (force * timestep) * 2.5;\
            vorticityVel = min(max(vorticityVel, -1000.0), 1000.0);\
            gl_FragColor = vec4(vorticityVel, 0.0, 1.0);\
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
        vec2 currentVelocity = texture2D(vel_tex, xy).xy;\
        \
        if(left.x < 0.0){ l = -currentVelocity.x; }\
        if(right.x > 1.0){ r = -currentVelocity.x; }\
        if(top.y > 1.0){ t = -currentVelocity.y; }\
        if(bottom.y < 0.0){ b = -currentVelocity.y; }\
        \
        \
        float divergence = (r - l + t - b);\
        gl_FragColor = vec4(((-2.0 * gridWidth * density) / timestep) \
            * divergence\
            , 0.0, 0.0, 1.0); \
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
      uniform float gridWidth;\
      uniform float gridHeight;\
      uniform sampler2D vel_tex; \
      uniform sampler2D press_tex; \
      \
      varying vec2 xy; \
      \
      void main() { \
      \
        vec2 left = xy - vec2(gridWidth, 0.0);\
        vec2 right = xy + vec2(gridWidth, 0.0);\
        vec2 top = xy + vec2(0.0, gridHeight);\
        vec2 bottom = xy - vec2(0.0, gridHeight);\
      \
        float l = texture2D(press_tex, left).x;\
        float r = texture2D(press_tex, right).x;\
        float t = texture2D(press_tex, top).x;\
        float b = texture2D(press_tex, bottom).x;\
        \
        vec2 curr = texture2D(vel_tex, xy).xy; \
        \
        float x_difference = r - l;\
        float y_difference = t - b;\
        \
        float new_x = curr.x - timestep/(1.0 * density * gridWidth) * x_difference;\
        float new_y = curr.y - timestep/(1.0 * density * gridHeight) * y_difference;\
        \
        gl_FragColor = vec4(new_x, new_y, 0.0, 0.0); \
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
        if (interpolation) {
            advectionInterpolationShader.uniforms({
                timestep: options.timestep,
                dissapation_factor: options.dissapation_factor,
                gridWidth: WIDTH,
                gridHeight: HEIGHT,
                x1Constraint: options.x1Constraint,
                y1Constraint: options.y1Constraint,
                x2Constraint: options.x2Constraint,
                y2Constraint: options.y2Constraint,
                freeze: options.freeze,
                timeScale: options.timescale,
                tex: 0,
                velocity_tex: 1
            });
            advectionInterpolationShader.draw(mesh, gl.TRIANGLE_STRIP);
        } else {
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

    var curl = (function (vel_tex) {
        vel_tex.bind(0);
        curlShader.uniforms({
            vel_tex: 0,
            gridWidth: 1 / WIDTH,
            gridHeight: 1 / HEIGHT,
        });
        curlShader.draw(mesh, gl.TRIANGLE_STRIP);
    });

    var vorticity = (function (curl_tex, vel_tex) {
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
            gridWidth: 1 / WIDTH,
            gridHeight: 1 / HEIGHT,
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

        gui.add(options, "draw").name("Draw on cursor").listen();
        gui.add(options, "select").name("Select on cursor").listen();

        gui.add(options, "density", 0.1, 2, 0.1).name("Density");
        gui.add(options, "dissapation_factor", 0.0, 1.0, 0.1).name("Dissipation");
        gui.add(options, "curl", 0.0, 40.0, 1).name("Vorticity");
        gui.add(options, "timescale", 0.25, 2.0, 0.25).name("timescale");
        gui.add(options, "jaccobi_iterations", 5.0, 40.0, 5.0).name("Jaccobi Iterations");
        gui.add(options, "test_constraint", 0.0, 1.0, 0.01).name("Test Constraint");

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


        gui.add(options, "tapping").name("Tapping effect");
        gui.add(options, "rake").name("Enable Rake");

        var rake = gui.addFolder("Rake Options");
        rake.add(rakeOptions, "rowCount", 1, 7, 1).name("Rake rows");
        rake.add(rakeOptions, "colCount", 1, 7, 1).name("Rake columns");
        rake.add(rakeOptions, "rowSpacing", 50, 500, 25).name("Rake row spacing");
        rake.add(rakeOptions, "colSpacing", 50, 500, 25).name("Rake column spacing");

    };

    var tempX1, tempX2, tempY1, tempY2 = 0;

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
        if (ev.key === "b") {
            if(options.freeze){
                tempX1 = options.x1Constraint;
                tempX2 = options.x2Constraint;
                tempY1 = options.y1Constraint;
                tempY2 = options.y2Constraint;

                options.x1Constraint = 0.0;
                options.x2Constraint = 1.0;
                options.y1Constraint = 0.0;
                options.y2Constraint = 1.0;

                options.freeze = false;
            }
            else{
                options.freeze = true;

                options.x1Constraint = tempX1;
                options.x2Constraint = tempX2;
                options.y1Constraint = tempY1;
                options.y2Constraint = tempY2;
            }

            console.log("reached");
        }
    })

    document.getElementById("main-body").addEventListener("auxclick", function(ev){
        if(ev.key == 1){
            console.log("middle click");
        }
    })

    document.getElementById("main-body").addEventListener("keydown", function (ev) {
        if(ev.key === "c") {
            options.selectdrag = true;
            console.log(options.selectdrag);
        }
        if(ev.key === "v") {
            options.selectend = true;
            console.log(options.selectend);
        }
    })

    document.getElementById("main-body").addEventListener("keyup", function (ev) {
        if(ev.key === "c") {
            options.selectdrag = false;
            console.log(options.selectdrag);
        }
        if(ev.key === "v") {
            options.selectend = false;
            console.log(options.selectend);
        }
    })

    optionsMenu();

    var restartSim = function () {
        options.freeze = false;
        velocity_tex0.drawTo(setColorShader(0, 0, 0, 1));
        color_tex0.drawTo(setColorShader(0.0, 0.0, 0.0, 0));
    }

    var calculateStep = function () {
        var currTime = Date.now();
        var timestep = (currTime - lastFrameTime) / 1000;
        timestep = Math.min(timestep, 1 / options.fps);
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
                //console.log(velocity_tex1);
                swap = swapTexture(velocity_tex0, velocity_tex1);
                velocity_tex0 = swap.t1;
                velocity_tex1 = swap.t2;

                if (options.pressure) {
                    if (options.vorticity) {
                        curl_tex0.drawTo(function () {
                            curl(velocity_tex0);
                        });

                        vort_tex0.drawTo(function () {
                            vorticity(curl_tex0, velocity_tex0);
                        });
                    } else {
                        vort_tex0 = velocity_tex0;
                    }

                    div_tex0.drawTo(function () {
                        divergence(vort_tex0);
                    });

                    for (var i = 0; i < options.jaccobi_iterations; i++) {
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

                swap = swapTexture(velocity_tex0, velocity_tex1);
                velocity_tex0 = swap.t1;
                velocity_tex1 = swap.t2;

                color_tex1.drawTo(function () {
                    advect(color_tex0, velocity_tex0, options.advection_interpolation);
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


    // Splosch functions
    var init = true;
    var initial = [0.0,0.0,0.0,0.0];
    var end = [0.0,0.0,0.0,0.0];
    var cursorBehaviour = function (ev) {

        console.log(ev.button);
        if(options.key == 0) {
            //var color = [0.001, 0.001, 0.001];
            if (options.draw) {
                if (ev.dragging) {
                    /*console.log(ev.deltaX);
                    console.log(ev.deltaY);
                    console.log(ev.offsetX);
                    console.log(ev.offsetY);*/
                    if (options.velocity_splosch) {
                        velocitySplosch(ev.deltaX, ev.deltaY, ev.offsetX, ev.offsetY);
                    } else if (options.rake) {
                        rake(rakeOptions.rowCount, rakeOptions.colCount, rakeOptions.rowSpacing, rakeOptions.colSpacing, ev);
                    } else if (options.tapping) {
                        brushTapping(ev.deltaX, ev.deltaY, ev.offsetX, ev.offsetY, options.tapAmount);
                    } else {
                        addSplosch(ev.deltaX, ev.deltaY, ev.offsetX, ev.offsetY);
                    }
                }
            }
        }
        if(options.key == 2){
            if(init){
                initial = [ev.deltaX, ev.deltaY, ev.offsetX, ev.offsetY];
                console.log(initial);
                init = false;
            }

            console.log("reached");

            if(options.selectend){
                end = [ev.deltaX, ev.deltaY, ev.offsetX, ev.offsetY];
                createConstraints(initial, end);

                options.selectend = false;
                init = true;
            }
        }
    }


    var createConstraints = function (ini, end){
        console.log(ini);
        console.log(end);

        options.x1Constraint = ini[2]/WIDTH;
        options.x2Constraint = end[2]/WIDTH;

        if(options.x1Constraint > options.x2Constraint){
            var temp = options.x1Constraint;
            options.x1Constraint = options.x2Constraint;
            options.x2Constraint = temp;
        }

        options.y1Constraint = 1.0 - ini[3]/HEIGHT;
        options.y2Constraint = 1.0 - end[3]/HEIGHT;

        if(options.y1Constraint < options.y2Constraint){
            var temp = options.y1Constraint;
            options.y1Constraint = options.y2Constraint;
            options.y2Constraint = temp;
        }

        options.freeze = true;

        console.log("constraints set");
        console.log(options.y1Constraint);
        console.log(options.y2Constraint);
    }


    function random_rgba() {
        var o = Math.round, r = Math.random, s = 255;
        return [o(r() * s) / 510, o(r() * s) / 510, o(r() * s) / 510];
    }

    var addSplosch = function (x, y, offsetX, offsetY, tool = false, newColor = 0) {
        var color = 0;
        if (!tool) {
            //console.log("reached");
            if (options.random_color) {
                var randR = getRandom(1, 255);
                var randG = getRandom(1, 255);
                var randB = getRandom(1, 255);

                color = random_rgba();
                // console.log(color);
            } else {
                color = [options.splosch_color[0] / 510, options.splosch_color[1] / 510, options.splosch_color[2] / 510];
            }
        } else {
            color = newColor;
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
                color.concat([0.0]),
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


    var brushTapping = function (x, y, offsetX, offsetY, amount) {
        var randX = 0, randY = 0, color = 0;

        for (var i = 0; i < amount; i++) {
            randX = getRandom(-options.brushHeight, options.brushHeight) + offsetX;
            randY = getRandom(-options.brushHeight, options.brushHeight) + offsetY;

            if (randX < 50) {
                randX = 50;
            } else if (randX > WIDTH) {
                randX = WIDTH - 50
            }

            if (randY < 50) {
                randY = 50;
            } else if (randY > HEIGHT) {
                randY = HEIGHT - 50
            }

            if (options.random_color) {
                color = random_rgba();
                addSplosch(x, y, randX, randY, true, color);
            } else {
                addSplosch(x, y, randX, randY)
            }


        }
    }

    var randomSplosches = function (amount) {
        var randWidth = 0;
        var randHeight = 0;
        var randXDir = 0;
        var randYDir = 0;
        var color = 0;

        for (var i = 0; i < amount; i++) {
            randWidth = getRandom(50, WIDTH - 50);
            randHeight = getRandom(50, HEIGHT - 50);

            var length = getRandom(4, 40);

            if (options.random_direction) {
                randXDir = getRandom(-4, 4);
                randYDir = getRandom(-4, 4);
            }

            if (options.random_color) {
                color = random_rgba();
            }

            for (var j = 0; j < length; j += 2) {
                if (options.random_color) {
                    addSplosch(randXDir, randYDir, randWidth + j, randHeight + j, true, color);
                } else {
                    addSplosch(randXDir, randYDir, randWidth + j, randHeight + j);
                }
            }

        }
    }

    // Rake & Comb utils
    var rake = function (rowCount, colCount, rowSpacing, colSpacing, event) {
        var rowPerSide = 0;
        var colPerSide = 0;

        if (rowCount == 1) {
            rowPerSide = rowCount;
        } else {
            rowPerSide = (rowCount - 1) / 2;
        }

        if (colCount == 1) {
            colPerSide = colCount;
        } else {
            colPerSide = (colCount - 1) / 2;
        }

        if (rowCount == 1) {
            if (colCount == 1) {
                addSplosch(event.deltaX, event.deltaY, event.offsetX, event.offsetY);
            } else {
                for (var j = -colPerSide; j <= colPerSide; j++) {
                    if ((colCount % 2) == 0 && j == 0) {
                        continue
                    }
                    addSplosch(event.deltaX, event.deltaY, event.offsetX + (j * colSpacing), event.offsetY);
                }
            }

        } else {
            for (var i = -rowPerSide; i <= rowPerSide; i++) {
                if ((rowCount % 2) == 0 && i == 0) {
                    continue
                }
                if (colCount == 1) {
                    addSplosch(event.deltaX, event.deltaY, event.offsetX, event.offsetY + (i * rowSpacing));
                } else {
                    for (var j = -colPerSide; j <= colPerSide; j++) {
                        if ((colCount % 2) == 0 && j == 0) {
                            continue
                        }
                        addSplosch(event.deltaX, event.deltaY, event.offsetX + (j * colSpacing), event.offsetY + (i * rowSpacing));
                    }
                }
            }
        }
    }

    /*gl.onmousedown = function (mousedownEvent) {
        cursorBehaviour(mousedownEvent);
        gl.onmousemove = function (mousemoveEvent) {
            cursorBehaviour(mousemoveEvent);
        }
    }*/

    gl.onmousemove = function (mousemoveEvent) {
        if(options.test){
            cursorBehaviour(mousemoveEvent);
        }

        gl.onmousedown = function (mousedownEvent) {
            options.test = true;
            options.key = mousedownEvent.button;
            if(options.key == 2){
                options.selectdrag = true;
            }
            cursorBehaviour(mousedownEvent);
        }

        gl.onmouseup = function (mouseupEvent) {
            options.test = false;
            if(mouseupEvent.button == 2){
                console.log("mouse up");
                options.selectdrag = false;
                options.selectend = true;
                cursorBehaviour(mouseupEvent);
            }
        }
    }

    gl.animate();
}