window.marbling = function() {

    // get canvas to render our simulation onto
    marb_canvas = document.getElementById("main-canvas");

    var gl = GL.create(marb_canvas); // create a new webgl context (lightgl) --  http://evanw.github.io/lightgl.js/docs/main.html

    // Set canvas dimensions
    gl.canvas.width = marb_canvas.offsetWidth;
    gl.canvas.height = marb_canvas.offsetHeight;

    var WIDTH = marb_canvas.offsetWidth;
    var HEIGHT = marb_canvas.offsetHeight;

    // Set viewport, x & y are 0 (lower left corner)
    gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);

    // mesh covering the canvas
    var mesh_data = {
        vertices: [[-1, 1], [1, 1], [-1, -1], [1, -1]],
        coords: [[0, 1], [1, 1], [0, 0], [1, 0]]
    }
    var mesh = gl.Mesh.load(mesh_data);

    // Create textures
    var velocity_tex0 = new gl.Texture(WIDTH, HEIGHT);
    velocity_tex0.type = gl.FLOAT;

    var color_tex0 = new gl.Texture(WIDTH, HEIGHT);
    color_tex0.type = gl.FLOAT;

    // Shaders GLSL -- https://webglfundamentals.org/webgl/lessons/webgl-shaders-and-glsl.html

    var vertex = '\
        varying vec2 xy;   \
        void main() {   \
            xy = gl_TexCoord.xy;  \
            gl_Position = gl_Vertex;  \
        }';

    var drawTexture = (function() {
        var shader = new gl.Shader(vertex, '\
            uniform sampler2D tex; \
            varying vec2 xy; \
            void main() { \
                gl_FragColor = texture2D(tex, xy); \
            } \
        ');

        return function(tex) {
            tex.bind(0);
            shader.draw(mesh, gl.TRIANGLE_STRIP)
        };
    })();

    var setColorShader = function(r, g, b, a){
        var colorShader = new gl.Shader(vertex, '\
            varying vec2 xy; \
            void main() { \
                gl_FragColor = vec4(' + [r, g, b, a].join(',') +'); \
            } \
        ');

        return function(){
            colorShader.draw(mesh, gl.TRIANGLE_STRIP);
        };
    }

    velocity_tex0.drawTo(setColorShader(1, 1, 1, 0));
    color_tex0.drawTo(setColorShader(0.1, 0.1, 0.5, 0));


    gl.ondraw = function() {
        gl.clearColor(1,1,1,1);
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
        drawTexture(color_tex0);
    }

    gl.onupdate = function () {
        // 1. Advection

    }

    gl.animate()
}