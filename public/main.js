var measuredIpd=0;
var shaderPrograms={};
var pMatrix = mat4.create();
var pMatrixScreen = mat4.create();
var cmapPMatrix = mat4.create();

var mvMatrix = mat4.create();
var playerCamera;
var lockedViewMat = null;

function init(){
    stats = new Stats();
	stats.showPanel( 0 ); // 0: fps, 1: ms, 2: mb, 3+: custom
	document.body.appendChild( stats.dom );

	var gui = new dat.GUI();
	var guiControllers = {};
	gui.add(guiParams, "fov", 10,150,5).onChange(setPerspective);
	gui.add(guiParams, "drawUsingCubemap");
	var viewShiftZAnglePrecision = 0.001;
	var centreZoomPrecision = 0.01;
	guiControllers.viewShiftZAngle = gui.add(guiParams, "viewShiftZAngle", -Math.PI/2,Math.PI/2,viewShiftZAnglePrecision);	//asin(viewShiftZ) ?
	guiControllers.centreZoom = gui.add(guiParams, "centreZoom", 0,15,centreZoomPrecision);	//TODO log scale? does dat gui support?
	guiControllers.viewShiftZAngle.onChange(val=>{
		var viewShiftZ = Math.sin(val);
		var centreZoom = (Math.sqrt((1+viewShiftZ)/(1-viewShiftZ)))	// sqrt( (1-val) * (1+val) ) / (1-val) = sqrt( (1+val)/(1-val)
		if (Math.abs(centreZoom - guiParams.centreZoom) > centreZoomPrecision){
			guiControllers.centreZoom.setValue(centreZoom);
		}
	});
	guiControllers.centreZoom.onChange(val=>{
		//console.log("inside centreZoom onchange");
		var centreZoomSq = val*val;
		var viewShiftZ = (centreZoomSq-1)/(centreZoomSq+1);
		var viewShiftZAngle = Math.asin(viewShiftZ);
		if (Math.abs(viewShiftZAngle - guiParams.viewShiftZAngle) > viewShiftZAnglePrecision){
			guiControllers.viewShiftZAngle.setValue(viewShiftZAngle);
		}
	});

	gui.add(guiParams, "zoomDirection", ["cockpit","headset","headset, lock zoom"]);
	gui.add(guiParams, "holdZoomMagFactor",2,16,0.5);
	gui.add(guiParams, "stabilisation",0,1,0.1);	//applies to headset, lock zoom. TODO apply to headset standard

	gui.add(guiParams, "sideLook", -3.2,3.2,0.05);	//radians. applies to non-vr mode
	gui.add(guiParams, "stereoSeparation", 0,0.005,0.0001);	//half eye separation, 1 unit = 10m
	gui.add(guiParams, "lockHeadPosToFrame");
	gui.add(guiParams, "drawDebugCubeFrames");
	gui.add(guiParams, "drawCircles");
	gui.add(guiParams, "drawSnellenChart");
	gui.add(guiParams, "drawNumberPlate");
	gui.add(guiParams, "autoScale");	//todo onchange grey out cubemapScale if true
	gui.add(guiParams, "tempCubemapScale", 0.1, 2.0, 0.05);
	gui.add(guiParams, "drawChequers");
	gui.add(guiParams, "wireframe");	//see whether object projecting cubemap onto is sufficiently well tesselated
	gui.add(guiParams, "useOtherShader");
	gui.add(guiParams, "aeroplaneAngVec", 0.1,1.0,0.1);

	var tmpObject;

	tmpObject = {};
	for (var elem=0;elem<16;elem++){
		tmpObject["matrixElement"+elem]=0;
		guiTestMatrix.values.push(tmpObject);
		guiTestMatrix.controllers.push(gui.add(guiTestMatrix.values[elem], "matrixElement"+elem, -1,1,0.001));
	}
	guiTestMatrix.values.push({rotationVal:0});
	guiTestMatrix.controllers.push(gui.add(guiTestMatrix.values[16], "rotationVal", 0,3.15,0.001));

    canvas = document.getElementById("mycanvas");

	initGL();
	setupVr();
    initShaders();
    initTexture();
    initCubemapFramebuffer(cubemapView);
    initBuffers();
    completeShaders();
    
    gl.enable(gl.DEPTH_TEST);
	gl.enable(gl.CULL_FACE);
	setupScene();
	requestAnimationFrame(drawScene);
}

function initShaders(){
    shaderPrograms.onetex = loadShader("shader-simple-vs", "shader-simple-fs");
    shaderPrograms.twotex = loadShader("shader-simple-vs", "shader-twotex-fs");
    shaderPrograms.fullscreenChequer = loadShader( "shader-fullscreen-vs", "shader-fullscreen-chequer-fs");
    shaderPrograms.simpleCubemap = loadShader( "shader-simple-cmap-vs", "shader-simple-cmap-fs");
	shaderPrograms.noTex = loadShader( "shader-notex-vs", "shader-notex-fs");
	shaderPrograms.vertProj = loadShader( "shader-vertproj-cmap-vs", "shader-simple-cmap-fs");
}

function completeShaders(){
	getLocationsForShaders();
}

var texture;
var texture2;
var textureSnellen;
var textureNumberPlate;
var textureRadio;
var textTexture;
var canvasTexture;
function initTexture(){
	texture2 = makeTexture("img/0033.jpg");
	textureSnellen = makeTexture("img/snellen_chart_1024.png");
	textureNumberPlate = makeTexture("img/british_car_registration_plate_no_EU_512_128.png");
	textureRadio = makeTexture("img/carradio-crop-resized.png");

	canvasTexture = (function(textureSize){
		var textCanvas = document.createElement("canvas");
		textCanvas.width = textureSize;
		textCanvas.height = textureSize;
		var canvasctx = textCanvas.getContext("2d");
		canvasctx.font = "60px Arial";
		
		//append to body to check (TODO disable this)
		document.getElementById("tmpdiv").appendChild(textCanvas);
	
		var texture = makePlaceholderTexture();
		var updateTexture = function(testString){
			canvasctx.fillStyle = "#3ff";
			canvasctx.fillRect(0,0,textureSize, textureSize);
			canvasctx.fillStyle = "red";
			canvasctx.fillText(testString, 10, 50);

			bind2dTextureIfRequired(texture);
			gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
			gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, textCanvas);

			gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);	//TODO do these carry over with updates?
			gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);	//TODO use mipmaps?
			bind2dTextureIfRequired(null);	//AFAIK this is just good practice to unwanted side effect bugs
		}		
	
		return {
			texture,
			updateTexture
		};
		//test dynamic update in console by canvasTexture.updateTexture("something")
	
	})(512);

	texture = canvasTexture.texture;
	canvasTexture.updateTexture("hello world");
}


function makePlaceholderTexture(){
	var texture = gl.createTexture();
	bind2dTextureIfRequired(texture);
	gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE,
		new Uint8Array([255, 0, 255, 255])); // magenta. should be obvious when tex not loaded.
	return texture;
}

function makeTexture(src, yFlip = true) {	//to do OO
	var texture = makePlaceholderTexture();
		
	//dummy 1 pixel image to avoid error logs. https://stackoverflow.com/questions/21954036/dartweb-gl-render-warning-texture-bound-to-texture-unit-0-is-not-renderable
		//(TODO better to wait for load, or use single shared 1pix texture (bind2dTextureIfRequired to check that texture loaded, by flag on texture? if not loaded, bind the shared summy image?
		//TODO progressive detail load?
	gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE,
              new Uint8Array([255, 0, 255, 255])); // magenta. should be obvious when tex not loaded.
	
	texture.image = new Image();
	texture.image.onload = function(){
		bind2dTextureIfRequired(texture);
		gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, yFlip);

		gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);	//linear colorspace grad light texture (TODO handle other texture differently?)
		
		gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, texture.image);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
		//gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
		gl.generateMipmap(gl.TEXTURE_2D);
		bind2dTextureIfRequired(null);	//AFAIK this is just good practice to unwanted side effect bugs
	};	
	texture.image.src = src;
	return texture;
}

var bind2dTextureIfRequired = (function createBind2dTextureIfRequiredFunction(){
	var currentlyBoundTextures=[];
	var currentBoundTex;
	return function(texToBind, texId = gl.TEXTURE0){	//TODO use different texture indices to keep textures loaded?
								//curently just assuming using tex 0, already set as active texture (is set active texture a fast gl call?)
		currentBoundTex = currentlyBoundTextures[texId];	//note that ids typically high numbers. gl.TEXTURE0 and so on. seem to be consecutive numbers but don't know if guaranteed.
        gl.activeTexture(texId);    //do always to handle changing active tex when craeting cubemap buffers
        if (texToBind != currentBoundTex){
			//gl.activeTexture(texId);
			gl.bindTexture(gl.TEXTURE_2D, texToBind);
			currentlyBoundTextures[texId] = texToBind;
		}
	}
})();

var cubemapView={};
//var cubemapSize = 1024;	//noticable pixellation. (unskewed cubemap)
var cubemapSize = 2048;		//large, guess poor perf on lower end machines.
function initCubemapFramebuffer(view){
    var framebuffers = [];
	view.framebuffers = framebuffers;
	
	view.cubemapTexture = gl.createTexture();
	
	gl.activeTexture(gl.TEXTURE1);	//use texture 1 always for cubemap
	gl.bindTexture(gl.TEXTURE_CUBE_MAP, view.cubemapTexture);
	gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
	gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
	gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
	gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

	var faces = [gl.TEXTURE_CUBE_MAP_POSITIVE_X,
				 gl.TEXTURE_CUBE_MAP_NEGATIVE_X,
				 gl.TEXTURE_CUBE_MAP_POSITIVE_Y,
				 gl.TEXTURE_CUBE_MAP_NEGATIVE_Y,
				 gl.TEXTURE_CUBE_MAP_POSITIVE_Z,
				 gl.TEXTURE_CUBE_MAP_NEGATIVE_Z];
	
	for (var i = 0; i < faces.length; i++)
	{
		var face = faces[i];
			
		var framebuffer = gl.createFramebuffer();
		gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
		framebuffer.width = cubemapSize;
		framebuffer.height = cubemapSize;
		framebuffers[i]=framebuffer;
		
		gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
		gl.texImage2D(face, 0, gl.RGBA, cubemapSize, cubemapSize, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
	
		var renderbuffer = gl.createRenderbuffer();
		gl.bindRenderbuffer(gl.RENDERBUFFER, renderbuffer);
		gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, cubemapSize, cubemapSize);
				
		gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, face, view.cubemapTexture, 0);
		gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, renderbuffer);
	}
	
	gl.bindRenderbuffer(gl.RENDERBUFFER, null);
	//gl.bindTexture(gl.TEXTURE_CUBE_MAP, null);	//this gets rid of errors being logged to console. 
	gl.bindFramebuffer(gl.FRAMEBUFFER, null);
}

var fsDeep = .4; //todo pass in (inverse) size to shader when drawing fullscreen quad, but this easier to adjust zoom
var fsData = {
	vertices:[
		-1,-1,-fsDeep,
		-1,1,-fsDeep,
		1,-1,-fsDeep,
		1,1,-fsDeep
	],
	indices:[
		//0,1,2,
		0,2,1,
		//1,3,2
		1,2,3
	]
}

var fsBuffers={};
var cubeBuffers={};
var cubeFrameBuffers={};
var sphereBuffers={};
var sphereBuffersHiRes={};
var aeroplaneBuffers={};
var carBuffers={};
var helicopterBuffers={};
var houseBuffers={};

function initBuffers(){
	var cacheAvoidString = "?t="+Date.now();

    loadBufferData(fsBuffers, fsData);
	loadBufferData(cubeBuffers, levelCubeData);
	loadBufferData(cubeFrameBuffers, cubeFrameSubdivData);
	loadBufferData(sphereBuffers, makeSphereData(8,16,1));
	//loadBufferData(sphereBuffersHiRes, makeSphereData(127,255,1)); //near index limit 65536.
	loadBufferData(sphereBuffersHiRes, makeSphereData(50,100,1));

	// loadBuffersFromObjFile(aeroplaneBuffers, "./data/a10ish2.obj", loadBufferData);
	loadBuffersFromObjFile(aeroplaneBuffers, "./data/T-50 Jet Fighter-1.obj"+cacheAvoidString, loadBufferData);
	loadBuffersFromObjFile(carBuffers, "./data/mpv2-scaledcentred.obj", loadBufferData);
	loadBuffersFromObjFile(helicopterBuffers, "./data/ah64-centred-.obj", loadBufferData);
	loadBuffersFromObjFile(houseBuffers, "./data/Sobrado_98-deleted-windows-and-doors.obj"+cacheAvoidString, loadBufferData);

    function loadBufferData(bufferObj, sourceData){
		bufferObj.vertexPositionBuffer = gl.createBuffer();
		bufferArrayData(bufferObj.vertexPositionBuffer, sourceData.vertices, sourceData.vertices_len || 3);
		if (sourceData.uvcoords){
			bufferObj.vertexTextureCoordBuffer= gl.createBuffer();
			bufferArrayData(bufferObj.vertexTextureCoordBuffer, sourceData.uvcoords, 2);
		}
		if (sourceData.velocities){	//for exploding objects
			bufferObj.vertexVelocityBuffer= gl.createBuffer();
			bufferArrayData(bufferObj.vertexVelocityBuffer, sourceData.velocities, 3);
		}
		if (sourceData.normals){
			bufferObj.vertexNormalBuffer= gl.createBuffer();
			bufferArrayData(bufferObj.vertexNormalBuffer, sourceData.normals, 3);
		}
		if (sourceData.tangents){
			bufferObj.vertexTangentBuffer= gl.createBuffer();
			bufferArrayData(bufferObj.vertexTangentBuffer, sourceData.tangents, 3);
		}
		if (sourceData.binormals){
			bufferObj.vertexBinormalBuffer= gl.createBuffer();
			bufferArrayData(bufferObj.vertexBinormalBuffer, sourceData.binormals, 3);
		}
		bufferObj.vertexIndexBuffer = gl.createBuffer();
		gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, bufferObj.vertexIndexBuffer);

		if (!sourceData.indices){
			sourceData.indices = sourceData.faces.flat();
		}

		gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(sourceData.indices), gl.STATIC_DRAW);
		bufferObj.vertexIndexBuffer.itemSize = 3;
		bufferObj.vertexIndexBuffer.numItems = sourceData.indices.length;

		bufferObj.isLoaded=true;
	}
}
function bufferArrayData(buffer, arr, size){
    bufferArrayDataGeneral(buffer, new Float32Array(arr), size);
}
function bufferArrayDataGeneral(buffer, arr, size){
   //console.log("size:" + size);
   gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
   gl.bufferData(gl.ARRAY_BUFFER, arr, gl.STATIC_DRAW);
   buffer.itemSize = size;
   buffer.numItems = arr.length / size;
}

function setupScene(){
    playerCamera = mat4.create();
    mat4.identity(playerCamera);
    
    movePlayer([0,-19.8,0.6]);   //move down 198m, back 6
	
	setPerspective();																		 
    mat4.perspective(90, 1, 0.005, 200.0, cmapPMatrix);
}

function setPerspective(){
	mat4.perspective(guiParams.fov, gl.viewportWidth/gl.viewportHeight, 0.005,200.0, pMatrixScreen);
}

function drawWorldScene(extraViewMat, camNum, positionShift, vecPositionShift){	//TODO encode rotateforface info inside extraMatrices

	var activeShaderProgram;

	var tmpCubemapScale = vec3.create([currentCubemapScale, currentCubemapScale, 1]);

	mat4.identity(mvMatrix);
	mat4.translate(mvMatrix, vec3.create([positionShift,0,0]));
	
	mat4.multiply(mvMatrix, extraViewMat);

	
	
	//mat4.set(extraViewMat, mvMatrix);
	var inversePlayerMat = mat4.create(playerCamera);	//TODO tidy up to not create a new matrix each time! cancel out inverses etc
	mat4.inverse(inversePlayerMat);

	mat4.multiply(mvMatrix, inversePlayerMat);	
	mat4.inverse(mvMatrix);

	//version with extraViewMat = identity.
	/*
    mat4.set(playerCamera, mvMatrix);   //copy mvMatrix from playerCamera. TODO matrices for various scene objects etc
	rotateCameraForFace(camNum);    //cubemap cameras 0 to 5. non-cubemap camera # -1
	mat4.inverse(mvMatrix);
	*/

	if (vecPositionShift){
		mat4.translate(mvMatrix, vec3.create(vecPositionShift));
	}

	//extra scaling for cubemap only (temp - should do this a better way)
	if (camNum != -1){
		mat4.scale(mvMatrix, tmpCubemapScale);
	}
	rotateCameraForFace(camNum);    //cubemap cameras 0 to 5. non-cubemap camera # -1

	mat4.inverse(mvMatrix);

    activeShaderProgram = shaderPrograms.twotex;
    gl.useProgram(activeShaderProgram);

	
	bind2dTextureIfRequired(texture2, gl.TEXTURE2);
    gl.uniform1i(activeShaderProgram.uniforms.uSampler2, 2);

	
	gl.uniform1i(activeShaderProgram.uniforms.uSampler, 0);
	

	
	var storedMat = mat4.create(mvMatrix);	//TODO don't keep creating new objects!
	//draw plane
	if (aeroplaneBuffers.isLoaded){

		bind2dTextureIfRequired(texture2);	//use basic texture for plane
		// var planeScale = 0.08;
		var planeScale = 0.2;
		gl.uniform3fv(activeShaderProgram.uniforms.uModelScale, [planeScale,planeScale,planeScale]);
		gl.uniform4fv(activeShaderProgram.uniforms.uColor, [1.5,1.5,1.5,1]);

		prepBuffersForDrawing(aeroplaneBuffers, activeShaderProgram);

		//one on the ground
		mat4.translate(mvMatrix, vec3.create([2,-20,0]));
		drawObjectFromPreppedBuffers(aeroplaneBuffers, activeShaderProgram);

		var numplanes = 10;
		var turnrad = 17;
		var turnacc = Math.pow(guiParams.aeroplaneAngVec,2)*turnrad*10;	//metres per sec per sec. *10 because 10m per unit
		var bankang = Math.atan2(turnacc,9.81);

		for (var ii=0;ii<numplanes;ii++){
			mat4.set(storedMat, mvMatrix);	//note counterintuitive function. copies a into b

			//one in the air
			var turnAmount = aeroplaneFlightRotation;
			mat4.rotateY(mvMatrix, turnAmount + ii*2*Math.PI/numplanes);	//turn
			
			mat4.translate(mvMatrix, vec3.create([turnrad,-16,0]));

			mat4.rotateZ(mvMatrix, bankang);	//bank left

			//speed of plane? radius * 1000 (ms per second) * 0.0004 = radius*0.4
			//radius = 16*10 (10m = 1 unit) . => 64m/s = 143mph (just above stall speed for a10)

			//acceleration = angular velocity * speed = 64m/s * 0.4 = 25.6 ms^-2.
			// /9.81 = 2.6gee . angle = atan(1/2.6) => 70 deg bank. total accn = root(2.6^2 + 1) = 2.78g

			drawObjectFromPreppedBuffers(aeroplaneBuffers, activeShaderProgram);

		}
		mat4.set(storedMat, mvMatrix);	//note counterintuitive function. copies a into b
	}

	if (helicopterBuffers.isLoaded){
		var helicopterScale = 0.1;
		gl.uniform3fv(activeShaderProgram.uniforms.uModelScale, [helicopterScale,helicopterScale,helicopterScale]);
		gl.uniform4fv(activeShaderProgram.uniforms.uColor, [0.25,0.25,0.25,1]);
		mat4.translate(mvMatrix, vec3.create([-3,-20,0]));
		prepBuffersForDrawing(helicopterBuffers, activeShaderProgram);
		mat4.rotateY(mvMatrix, -Math.PI/2);
		drawObjectFromPreppedBuffers(helicopterBuffers, activeShaderProgram);
		mat4.translate(mvMatrix, vec3.create([2,20,0]));
		mat4.set(storedMat, mvMatrix);
	}

	if (houseBuffers.isLoaded){
		var houseScale = 0.1;
		gl.uniform3fv(activeShaderProgram.uniforms.uModelScale, [houseScale,houseScale,houseScale]);
		gl.uniform4fv(activeShaderProgram.uniforms.uColor, [2,1.4,1,1]);
		mat4.translate(mvMatrix, vec3.create([-1,-20,-2]));
		prepBuffersForDrawing(houseBuffers, activeShaderProgram);
		mat4.rotateY(mvMatrix, -Math.PI/2);
		drawObjectFromPreppedBuffers(houseBuffers, activeShaderProgram);
		mat4.translate(mvMatrix, vec3.create([2,20,0]));
		mat4.set(storedMat, mvMatrix);
	}

	
	//draw car
	if (carBuffers.isLoaded){
		var carScale = 0.1;	//make car quite big so can conveniently get inside it. (note inconsistent scale with plane)
		gl.uniform3fv(activeShaderProgram.uniforms.uModelScale, [carScale,carScale,carScale]);
		gl.uniform4fv(activeShaderProgram.uniforms.uColor, [0.8,1,1,1]);
		// mat4.translate(mvMatrix, vec3.create([0,-10.29,0]));
		mat4.translate(mvMatrix, vec3.create([0,-20,0]));
		prepBuffersForDrawing(carBuffers, activeShaderProgram);
		drawObjectFromPreppedBuffers(carBuffers, activeShaderProgram);
		mat4.translate(mvMatrix, vec3.create([0,0,-2]));	//one tenth scale. 2 = 20m
		drawObjectFromPreppedBuffers(carBuffers, activeShaderProgram);

		//put a number plate on the second car
		bind2dTextureIfRequired(textureNumberPlate);
		prepBuffersForDrawing(cubeBuffers, activeShaderProgram);

		gl.uniform3fv(activeShaderProgram.uniforms.uModelScale, [0.5*0.0483,0.5*0.0103,0.0005]);	//TODO simple quad for efficiency
		gl.uniform4fv(activeShaderProgram.uniforms.uColor, [1,1,1,1]);	//white
		// mat4.translate(mvMatrix, vec3.create([-0.345,0.46,0.34]));	//sideways, up, back
		mat4.translate(mvMatrix, vec3.create([0,0.0893,0.2677]));	//sideways, up, back
		drawObjectFromPreppedBuffers(cubeBuffers, activeShaderProgram);

		//draw car radio
		bind2dTextureIfRequired(textureRadio);
		var radioPixelSize = 0.00001;
		mat4.translate(mvMatrix, vec3.create([0,0.02,1.67]));
		mat4.rotateX(mvMatrix, -0.3);
		gl.uniform3fv(activeShaderProgram.uniforms.uModelScale, [radioPixelSize*1183,radioPixelSize*356,radioPixelSize*10]);
		drawObjectFromPreppedBuffers(cubeBuffers, activeShaderProgram);

		mat4.set(storedMat, mvMatrix);
	}

	//draw cube frame.
	//TODO draw this at origin of player frame, so can see what it rotating etc.
	var cfScale = 1;
	gl.uniform3fv(activeShaderProgram.uniforms.uModelScale, [cfScale,cfScale,cfScale]);
	gl.uniform4fv(activeShaderProgram.uniforms.uColor, [0,3,0,1]);	//green
	mat4.translate(mvMatrix, vec3.create([5,-19,0]));
	prepBuffersForDrawing(cubeFrameBuffers, activeShaderProgram);
	drawObjectFromPreppedBuffers(cubeFrameBuffers, activeShaderProgram);

	if (guiParams.drawDebugCubeFrames){
		cfScale = 0.1;
		gl.uniform3fv(activeShaderProgram.uniforms.uModelScale, [cfScale,cfScale,cfScale*2]);
			//longer so can see in standard fov view. 2mx2mx4m box

		mat4.identity(mvMatrix);
		drawObjectFromPreppedBuffers(cubeFrameBuffers, activeShaderProgram);

		//draw another box where "playerCamera" is (the frame that flight controls move. head position is
		//locked to this if guiParams.lockHeadPosToFrame is true
		mat4.set(storedMat, mvMatrix);
		mat4.multiply(mvMatrix, playerCamera);

		gl.uniform4fv(activeShaderProgram.uniforms.uColor, [3,0,0,1]);	//red
		cfScale = 0.2;
		gl.uniform3fv(activeShaderProgram.uniforms.uModelScale, [cfScale,cfScale,cfScale*1.9]);
		drawObjectFromPreppedBuffers(cubeFrameBuffers, activeShaderProgram);
	}

	mat4.set(storedMat, mvMatrix);	//note counterintuitive function. copies a into b

    bind2dTextureIfRequired(texture);	//use other texture for boxes

    prepBuffersForDrawing(cubeBuffers, activeShaderProgram);
	
	var bigBoxScale = 20;
	gl.uniform4fv(activeShaderProgram.uniforms.uColor, [1,1,1,1]);	//white
	// mat4.scale(mvMatrix, vec3.create([-100,-100,-100]));	//big inverted box. 
	gl.uniform3fv(activeShaderProgram.uniforms.uModelScale, [-bigBoxScale,-bigBoxScale,-bigBoxScale]);
	drawObjectFromPreppedBuffers(cubeBuffers, activeShaderProgram);
	
    var boxScale = 0.1;
	gl.uniform3fv(activeShaderProgram.uniforms.uModelScale, [boxScale,boxScale,boxScale]);
	gl.uniform4fv(activeShaderProgram.uniforms.uColor, [1,0,0,1]);
    var moveVec = vec3.create([0,0,0.5]);
    for (var xx=0;xx<10;xx++){
        drawObjectFromPreppedBuffers(cubeBuffers, activeShaderProgram);
        mat4.translate(mvMatrix, moveVec);
	}


	

	if (camNum!=-1 && guiParams.drawChequers){
		gl.enable(gl.BLEND);
		gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

		gl.depthMask(false);
		//draw a chequer pattern. could do this by gr rect etc, but do by standard rendering
		activeShaderProgram = shaderPrograms.fullscreenChequer;
		gl.useProgram(activeShaderProgram);
		drawObjectFromBuffers(fsBuffers, activeShaderProgram);
		gl.disable(gl.BLEND);
		gl.depthMask(true);
	}


	if (guiParams.drawSnellenChart){
		drawPlaneObject(textureSnellen, [0,0,-2], [0.06997,0.08721,0.00001]);
	}

	if (guiParams.drawNumberPlate){
		drawPlaneObject(textureNumberPlate, [0,-0.2,-4], [0.0483,0.0103,0.00001]);	//moved down a litte below snellen. (number plate reading test @20m)
	}

	function drawPlaneObject(tex, pos, scale){
		activeShaderProgram = shaderPrograms.onetex;
		gl.useProgram(activeShaderProgram);
		bind2dTextureIfRequired(tex);
		gl.uniform1i(activeShaderProgram.uniforms.uSampler, 0);
		prepBuffersForDrawing(cubeBuffers, activeShaderProgram);
		gl.uniform3fv(activeShaderProgram.uniforms.uModelScale, scale);	//TODO simple quad for efficiency
		gl.uniform4fv(activeShaderProgram.uniforms.uColor, [1,1,1,1]);	//white
		mat4.set(extraViewMat, mvMatrix);	//TODO tidy up matrix mess!!
		mat4.inverse(mvMatrix);
		//extra scaling for cubemap only (temp - should do this a better way)
		if (camNum != -1){
			mat4.scale(mvMatrix, tmpCubemapScale);
		}
		rotateCameraForFace(camNum);
		mat4.inverse(mvMatrix);
		mat4.translate(mvMatrix, vec3.create(pos));	//straight ahead . note that because no binocular difference, appears to be at infinity
		drawObjectFromPreppedBuffers(cubeBuffers, activeShaderProgram);
	}


	if (!guiParams.drawCircles){return;}	//save a lot of draw calls.

	activeShaderProgram = shaderPrograms.noTex;
    gl.useProgram(activeShaderProgram);
	prepBuffersForDrawing(sphereBuffers, activeShaderProgram);


	var miniBoxScale = 0.1;
	gl.depthFunc(gl.ALWAYS);
	//make balls big enough that despite drawing in "cockpit" frame, don't have much parallax
						//when move head (TODO draw at inf, or at eye pos)

	gl.uniform3fv(activeShaderProgram.uniforms.uModelScale, [miniBoxScale,miniBoxScale,miniBoxScale]);
    gl.uniform4fv(activeShaderProgram.uniforms.uColor, [1,1,0,1]);	//yellow

	//draw objects around "cockpit"
	//mat4.identity(mvMatrix);   //copy mvMatrix from playerCamera. TODO matrices for various scene objects etc
	mat4.set(extraViewMat, mvMatrix);	//TODO tidy up matrix mess!!
	mat4.inverse(mvMatrix);

	//extra scaling for cubemap only (temp - should do this a better way)
	if (camNum != -1){
		mat4.scale(mvMatrix, tmpCubemapScale);
	}
	rotateCameraForFace(camNum);
	mat4.inverse(mvMatrix);

	//make balls at distance such that appear ~ same size as moon in sky.
	//moon's radius ~ 0.45% of distance to moon.
	var distAway = miniBoxScale/0.0045;	//0.22
	var distAway45deg = distAway*Math.sqrt(0.5);

	mat4.translate(mvMatrix, vec3.create([0,0,-distAway]));	//straight ahead
	drawObjectFromPreppedBuffers(sphereBuffers, activeShaderProgram);

	drawBallRing([0,0,1,1], 10, distAway, 0);			//blue, splitting front, back
	drawBallRing([1,0.5,0,1], 20, distAway45deg, distAway45deg);	//orange, 45 deg in front
	drawBallRing([1,0.5,0,1], 20, distAway45deg, -distAway45deg);	//orange, 45 deg behind

	gl.depthFunc(gl.LESS);

	function drawBallRing(color, angstep, side, front){
		gl.uniform4fv(activeShaderProgram.uniforms.uColor, color);
		
		for (var ang=0;ang<360;ang+=angstep){
			//mat4.identity(mvMatrix);   //copy mvMatrix from playerCamera. TODO matrices for various scene objects etc
			mat4.set(extraViewMat, mvMatrix);
			mat4.inverse(mvMatrix);
			//extra scaling for cubemap only (temp - should do this a better way)
			if (camNum != -1){
				mat4.scale(mvMatrix, tmpCubemapScale);
			}
			rotateCameraForFace(camNum);
			mat4.inverse(mvMatrix);

			var rads = ang*Math.PI/180;
			mat4.translate(mvMatrix, vec3.create([side*Math.cos(rads),side*Math.sin(rads),-front]));
			drawObjectFromPreppedBuffers(sphereBuffers, activeShaderProgram);
		}
	}
}

var identMat = mat4.identity();
var leftView = mat4.create();
var rightView = mat4.create();

function drawScene(frameTime){	
	//resizecanvas();	//removed to stop interfering with VR stuff.
						//TODO handle window resizing
	iterateMechanics(frameTime);
		//TODO best place for this? doesn't matter now - uses very little resources
	
	//examples use same callback to draw scene for vr, non-vr
	//TODO is it better to have different callbacks?

	currentCubemapScale = guiParams.autoScale ?  1/(guiParams.centreZoom*viewScaleMultiplier) : guiParams.tempCubemapScale;

	var vecEyeSeparation=[0,0,0];	//default. overwrite if VR.
	var vecEyeSeparation2=[0,0,0];

	if (vrDisplay && vrDisplay.isPresenting){
		vrDisplay.requestAnimationFrame(drawScene);
		

		vrDisplay.getFrameData(frameData);
		gl.clearColor.apply(gl,[1,0,1,1]);  //purple
		gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
		//get view matrix. zero position part to get pure rotation.
		mat4.set( frameData.leftViewMatrix, leftView);
		mat4.set( frameData.rightViewMatrix, rightView);

		vecEyeSeparation[0] = leftView[0];	//want sideways pointing vector.
		vecEyeSeparation[1] = leftView[4];
		vecEyeSeparation[2] = leftView[8];

		//set length to stereo separation.
		var factor = guiParams.stereoSeparation / Math.hypot.apply(null, vecEyeSeparation);
		vecEyeSeparation = vecEyeSeparation.map(x=>-x*factor);
		vecEyeSeparation2 = vecEyeSeparation.map(x=>-x);
	}else{
		//console.log("requesting standard animation frame");
		requestAnimationFrame(drawScene);
	}
	
    stats.end();
    stats.begin();




function updateCubemap(vecEyeSeparation, eyeViewMat){

	//DRAW CUBEMAP
    gl.clearColor.apply(gl,[0,1,1,1]);  //cyan
    var numFacesToUpdate = 6;
    mat4.set(cmapPMatrix, pMatrix);
    
    for (var ii=0;ii<numFacesToUpdate;ii++){
        var framebuffer = cubemapView.framebuffers[ii];
        gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
        gl.viewport(0, 0, framebuffer.width, framebuffer.height);
		gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
		
		//TODO just store difference between cockpit and view mat
		var matToPassIn;
		if (guiParams.zoomDirection == "cockpit"){
			matToPassIn = identMat;		//could just use eyeViewMat here because passing in.
		}else if(guiParams.zoomDirection == "headset"){
			matToPassIn = eyeViewMat;
		}else if(guiParams.zoomDirection == "headset, lock zoom"){
			//TODO expect this should be rotation between lockedViewMat, cockpit view
			matToPassIn = lockedViewMat || eyeViewMat;
		}

		//correct vecEyeSeparation for cubemap in headset frame, where appropriate
		// there might be a glmatrix method for this but can't find it!!!
		var rotatedVec3 = vec3.create([0,0,0]);
		for (var aa=0;aa<3;aa++){
			for (var bb=0;bb<3;bb++){
				rotatedVec3[aa] += matToPassIn[bb*4 + aa] * vecEyeSeparation[bb];
			}
		}

        drawWorldScene(matToPassIn, ii, 0, rotatedVec3);
	}
	gl.bindFramebuffer(gl.FRAMEBUFFER, null);
}
	
	if (vrDisplay && vrDisplay.isPresenting){
		
		//TODO allow zeroing of view. where should mobile reference frame be? move with head but not rotate? or show it- eg put
		// at seat of pants
		//TODO proper solution - use leftView/rightview because user IPD is set.

		var avgView = [(leftView[12]+rightView[12])/20, (leftView[13]+rightView[13])/20, (leftView[14]+rightView[14])/20];
			//note division by 10 because 1 unit in game = 10m

		var diffView = [leftView[12]-rightView[12], leftView[13]-rightView[13], leftView[14]-rightView[14]];
		measuredIpd = Math.sqrt(diffView[0]*diffView[0] + diffView[1]*diffView[1] + diffView[2]*diffView[2]);
			//allow to be found by console command
		
		if (guiParams.lockHeadPosToFrame){
			leftView[12]=0;		//TODO use headset position when drawing cubemap.
			leftView[13]=0;		//for now, just use rotation part of view matrix - effectively
			leftView[14]=0;		//infinitely distant cubemap. FWIW could be made more efficient
			rightView[12]=0;	//by duplicating left, right views, if same rotation part (this is true for rift, perhaps for this reason)
			rightView[13]=0;
			rightView[14]=0;
		}else{
			leftView[12]=avgView[0];
			leftView[13]=avgView[1];		
			leftView[14]=avgView[2];		
			rightView[12]=avgView[0];	
			rightView[13]=avgView[1];
			rightView[14]=avgView[2];
		}

		if (guiParams.drawUsingCubemap){
			updateCubemap(vecEyeSeparation, leftView);
		}

		gl.viewport(0, 0, canvas.width/2, canvas.height);
		mat4.set(frameData.leftProjectionMatrix, pMatrix);
		if (guiParams.drawUsingCubemap){
			renderViewUsingCmap(leftView);
		}else{
			renderViewNoCmap(leftView, guiParams.stereoSeparation);
		}

		if (guiParams.drawUsingCubemap && guiParams.stereoSeparation!=0){
			updateCubemap(vecEyeSeparation2, rightView);
		}

		gl.viewport(canvas.width/2, 0, canvas.width/2, canvas.height);
		mat4.set(frameData.rightProjectionMatrix, pMatrix);
		if (guiParams.drawUsingCubemap){
			renderViewUsingCmap(rightView);
		}else{
			renderViewNoCmap(rightView, -guiParams.stereoSeparation);
		}

		vrDisplay.submitFrame();

	}else{

		updateCubemap(vecEyeSeparation, identMat);

		gl.viewport(0, 0, canvas.width, canvas.height);
		mat4.set(pMatrixScreen, pMatrix);

		if (guiParams.drawUsingCubemap){

			//various ways to do this. some maybe more efficient than others
			//1. fullscreen quad, per vertex projection. should be simple for undistorted. 

			//2. simple projection on a sphere. should be easy maths, can do in vertex shader.
			renderViewUsingCmap(identMat, true);
		}else{
			gl.clearColor.apply(gl,[0,1,0,1]);  //green
			gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
			renderViewNoCmap(identMat, 0);
		}
	}

	
	function renderViewUsingCmap(extraViewMat, doSidelook){	//TODO pass in sidelook via extraViewMat
		gl.clearColor.apply(gl,[0,0,1,1]);  //blue

		var activeShaderProgram = shaderPrograms.simpleCubemap;
		gl.useProgram(activeShaderProgram);
		gl.uniform1i(activeShaderProgram.uniforms.uSampler, 1);
		mat4.identity(mvMatrix);
		

		//AFAIK this is between cubemap and view directions. ie guess want to rotate by inverse of cubemap orientation relative to cockpit.
		if (guiParams.zoomDirection == "cockpit"){
			mat4.multiply(mvMatrix, extraViewMat);
		}else if(guiParams.zoomDirection == "headset"){
			//do nothing.
		}else if(guiParams.zoomDirection == "headset, lock zoom"){
			//rotation between lockedViewMat, extraViewMat
			mat4.multiply(mvMatrix, extraViewMat);
			lockedViewMat = lockedViewMat || mat4.create(extraViewMat);
			var invLockMat = mat4.create(lockedViewMat);
			mat4.inverse(invLockMat);
			mat4.multiply(mvMatrix, invLockMat);
		}

		if (doSidelook){
			mat4.rotate(mvMatrix,  guiParams.sideLook, vec3.create([0,1,0]));
		}

		var relativeLookMat = mat4.create(mvMatrix);
		var invRelativeLookMat = mat4.create(relativeLookMat)
		mat4.inverse(invRelativeLookMat);

		//simple translation by -1 gets stereographic angle preserving projection on screen
		//however, want to get view that's angle preserving when viewed at the set pMatrix FOV. to do this, scale view.
		
		//currently cubemap is in frame of cockpit.
		//maybe TODO, make cubemap in frame of zoom direction. might make skewing view frusta easier
		// +avoids rotation by extraViewMat2 and its inverse, below

		var adjustedCentreZoom = viewScaleMultiplier * guiParams.centreZoom;
		var adjustedCentreZoomSq = adjustedCentreZoom*adjustedCentreZoom;
		var adjustedViewShiftZ = (adjustedCentreZoomSq-1)/(adjustedCentreZoomSq+1);
		var scaleFactor = 1/Math.sqrt(1-adjustedViewShiftZ*adjustedViewShiftZ);
		mat4.scale(mvMatrix, vec3.create([1,1,scaleFactor]));
		mat4.translate(mvMatrix, vec3.create([0,0,adjustedViewShiftZ]));
		
		gl.uniform3fv(activeShaderProgram.uniforms.uCmapScale, [1,1,currentCubemapScale]);

		if (!guiParams.useOtherShader){
			if (guiParams.wireframe){
				drawObjectFromBuffers(sphereBuffersHiRes, activeShaderProgram, null, gl.LINES);
			}else{
				drawObjectFromBuffers(sphereBuffersHiRes, activeShaderProgram);
			}
		}else{
			//draw by another method. project vertices from viewpoint, onto surface of above sphere/ellipsoid
			//each vertex should remain in same point on screen. if depth is correct, distortion should be minimised, but if depth 
			//constant (eg simple flat grid), should work OK.

			activeShaderProgram = shaderPrograms.vertProj;
			gl.useProgram(activeShaderProgram);

			//centrePos is in direction suspect will come from some row/column of relativeLookMat
			//var lookDirection = [relativeLookMat[2], relativeLookMat[5],relativeLookMat[8]];	//guess one of these
			var lookDirection = [relativeLookMat[8], relativeLookMat[9],relativeLookMat[10]];
			
			var centrePos = lookDirection.map(x=>x*adjustedViewShiftZ);		
			//var centrePos = [0,0,adjustedViewShiftZ];		//position of sphere centre in camera frame (or -ve this?)
									//TODO proper value, but in simple cases, (zoom in headset direction) is just in z-direction

		//	gl.uniform3fv(activeShaderProgram.uniforms.uCentrePosScaled, [0,0,0]);			//TODO
			gl.uniform3fv(activeShaderProgram.uniforms.uCentrePosScaled, centrePos);			//TODO

			var scaleMat = mat3.identity();
			scaleMat[8]=scaleFactor;
			var scaleMat2 = mat3.identity();
			scaleMat2[8]=1/scaleFactor;

			//rotation between zoom matrix and current view. (?)
			var invTexRotateMatrix = makeMat3FromMat4(invRelativeLookMat);
			var texRotateMatrix = makeMat3FromMat4(relativeLookMat);

			//NOTE suspect can get rid of much code if allow object to rotate - can do if keep closed object (like sphere).
			//might want texRotateMatrix = identity, so simple scale mats, but then cubemap should be scaled by matrix not vector

			//rotate scale mats. possible to simplify?
			var directedScaleMat = mat3.create(texRotateMatrix);
			mat3.multiply(directedScaleMat, scaleMat);
			mat3.multiply(directedScaleMat, invTexRotateMatrix);
			
			var directedScaleMat2 = mat3.create(texRotateMatrix);
			mat3.multiply(directedScaleMat2, scaleMat2);
			mat3.multiply(directedScaleMat2, invTexRotateMatrix);

			gl.uniformMatrix3fv(activeShaderProgram.uniforms.uStretchMatrix, false, directedScaleMat2);		//TODO
			gl.uniformMatrix3fv(activeShaderProgram.uniforms.uUnStretchMatrix, false, directedScaleMat);	//TODO

			gl.uniformMatrix3fv(activeShaderProgram.uniforms.uTexRotateMatrix, false, invTexRotateMatrix);
			gl.uniform1i(activeShaderProgram.uniforms.uSampler, 1);
			gl.uniform1f(activeShaderProgram.uniforms.uCmapscale,currentCubemapScale);

			gl.disable(gl.CULL_FACE);	//TODO invert sphere?
			if (guiParams.wireframe){
				drawObjectFromBuffers(sphereBuffersHiRes, activeShaderProgram, null, gl.LINES);
			}else{
				drawObjectFromBuffers(sphereBuffersHiRes, activeShaderProgram);
			}
			gl.enable(gl.CULL_FACE);


		}

	}

	function renderViewNoCmap(extraViewMat, positionShift){
						//positionShift - used for stereo separation. could/should use full extraViewMat (rather than just extracting rotation part),
						// but want, for now, to not move centre of view. 

	//	drawWorldScene(-1);
		drawWorldScene(extraViewMat, -1, positionShift);		
	}
}

function makeMat3FromMat4(sourceMat4){	//glmatrix docs claim there is a method to get a mat3 from a mat4, but cannot find.
										//looks like available docs are for version 2.
	var destMat3 = mat3.create();	//todo reuse some matrix
	for (var ii=0;ii<3;ii++){
		for (var jj=0;jj<3;jj++){
			destMat3[ii*3+jj] = sourceMat4[ii*4+jj];
		}
	}
	return destMat3;
}

function rotateCameraForFace(ii){
	var piBy2= Math.PI/2;
	var xVec = vec3.create([1,0,0]);
	var yVec = vec3.create([0,1,0]);
	var zVec = vec3.create([0,0,1]);
    switch(ii){
        case 0:
            mat4.rotate(mvMatrix, piBy2, yVec);
            break;
        case 1:
			mat4.rotate(mvMatrix, -piBy2, yVec);
            break;
        case 2:
			mat4.rotate(mvMatrix, -piBy2, xVec);
			mat4.rotate(mvMatrix, Math.PI, zVec);
            break;
        case 3:
			mat4.rotate(mvMatrix, piBy2, xVec);
			mat4.rotate(mvMatrix, Math.PI, zVec);
            break;
        case 4:
			mat4.rotate(mvMatrix, Math.PI, yVec);
            break;
        case 5:
            break;
    }
    
}   

//TODO ui controls
var guiParams = {
	fov:40,	//vertical fov. 40deg = -20 to +20	.
	drawUsingCubemap:true,
	autoScale:true,
	viewShiftZAngle:0,
	centreZoom:1,
	zoomDirection:"headset, lock zoom",
	holdZoomMagFactor:4,
	stabilisation:0.5,	//1= fixed, 0=responds to movement without smoothing
	sideLook:0,
	stereoSeparation:0.0034,	//~6.8cm separation. approx human
	lockHeadPosToFrame:false,
	drawDebugCubeFrames:true,
	drawCircles:false,
	drawSnellenChart:false,
	drawNumberPlate:false,
	tempCubemapScale:1,	//stretch cubemap so forward view frustrum can be tighter for high zoom etc.
						//TODO rear frustum should expand when forward tightens and vice versa, 
						// but simple scaling should get decent pixel scale matching in centre of screen.

						//TODO auto adjustment with zoom
						//TODO follow zoom direction (currently assumes zoom aligned with cockpit)
	drawChequers:false,
	wireframe:false,
	useOtherShader:true,
	aeroplaneAngVec:0.4
}
var guiTestMatrix={values:[],controllers:[]};

var viewScaleMultiplier = 1;
var currentCubemapScale = 1;
var aeroplaneFlightRotation = 0;


var iterateMechanics = (function iterateMechanics(){
    var lastTime=Date.now();
    
    var moveSpeed=-0.000075;
    var rotateSpeed=-0.0005;

    var playerVelVec = [0,0,0];
    var playerAngVelVec = [0,0,0];

    var timeTracker =0;
	var timeStep = 2;	//2ms => 500 steps/s! this is small to prevent tunelling. TODO better collision system that does not require this!
	var timeStepMultiplier = timeStep/50;	//because stepSpeed initially tuned for timeStep=10;
    var angVelDampMultiplier=Math.pow(0.9, timeStep/10);

    var thrust = 0.05*timeStep;	//TODO make keyboard/gamepad fair! currently thrust, moveSpeed config independent!

    var currentThrustInput = [0,0,0];
    var currentRotateInput=[];

	//gamepad
	var activeGp;

    return function(frameTime){
		activeGp=getGamepad();

        var nowTime = Date.now();
		var timeElapsed = Math.min(nowTime - lastTime, 50);	//ms. 50ms -> slowdown if drop below 20fps 
		//console.log("time elapsed: " + timeElapsed);
        lastTime=nowTime;
		
		aeroplaneFlightRotation += guiParams.aeroplaneAngVec*timeElapsed*0.001;
		aeroplaneFlightRotation %= 2*Math.PI;
			//TODO correction for display time (unknown if vr object gives better timer)
		
        timeTracker+=timeElapsed;
		var numSteps = Math.floor(timeTracker/timeStep);
		timeTracker-=numSteps*timeStep;
		for (var ii=0;ii<numSteps;ii++){
			stepSpeed();
        }
        
        function stepSpeed(){	//TODO make all movement stuff fixed timestep (eg changing position by speed)

			//smoothing of zoom frame
			if (lockedViewMat){
			//	if (guiParams.stabilisation == 0){
			//		mat4.set(leftView, lockedViewMat);	//equivalent to all the below for 0 stabilisation
			//	}
				//"averaging" maybe a bit tricky - new version of lockedViewMat should be created by rotating leftView (assumed to be =rightView)
				//towards pointing (z) in same direction as lockedViewMat, by a fraction Math.pow(guiParams.stabilisation, something), to get exponential 
				//decay. with full stabilisation (1), still expect to see roll such that cubemap, view direction ~ line up
				
				//get matrix between leftView, lockedViewMat, to see which elements describe lockedView direction in frame of leftView (current headset)
				var invLockMat = mat4.create(lockedViewMat);	//TODO retain this inverse mat since used elsewhere
				mat4.inverse(invLockMat);

				var tmpMat = mat4.create(leftView);
				mat4.multiply(tmpMat, invLockMat);

				//display invLockMat in ui
				for (var elem=0;elem<16;elem++){
					guiTestMatrix.controllers[elem].setValue(tmpMat[elem]);
				}
				//pitching increases 6,9 in opposition (starting from zero)
				//rolling ........ 1,4
				//turning ........ 2,8

				//									lockedview
				//  0		roll	turn	3		left
				//  roll	5		pitch	7
				//  turn	pitch   10		11		fwd
				//	12		13		14		15

		// headset	left			fwd

				//try turning after roll. 2 changes consistently with previous, so suppose 2 is headset forward projected onto lockedview left..

				//what rotation want to do to stay pointed at lockview, with rotation about axis perpendicular to headset forwards.
				//want to look at lockedview fwd projected onto headset all axes of headset (current). elements 8,9,10.

				//create a rotation vector that describes rotation in frame of headset that would rotate to current lockview
				var rotationAmount = Math.atan2(Math.hypot(tmpMat[8],tmpMat[9]), tmpMat[10]);
				guiTestMatrix.controllers[16].setValue(rotationAmount);

				rotationAmount*= Math.pow(guiParams.stabilisation, 0.01);	//simple stabilisation <1: multiply this by stabilisation^somePower
				
				mat4.set(leftView, lockedViewMat);	//copies leftView into lockedViewMat
				mat4.inverse(lockedViewMat);
				mat4.rotate(lockedViewMat, rotationAmount, vec3.create([-tmpMat[9],tmpMat[8],0]));	//afaik rotation normalises input vector
				mat4.inverse(lockedViewMat);

				//TODO higher order smoothing - spring/damper for nonzero mass (current is like spring/damper for mass->0)
			}

			currentThrustInput[0]=keyThing.keystate(65)-keyThing.keystate(68);	//lateral
			currentThrustInput[1]=keyThing.keystate(32)-keyThing.keystate(220);	//vertical
            currentThrustInput[2]=keyThing.keystate(87)-keyThing.keystate(83);	//fwd/back
            
            currentThrustInput=currentThrustInput.map(function(elem){return elem*thrust;});
			
			currentRotateInput[0]=keyThing.keystate(40)-keyThing.keystate(38); //pitch
			currentRotateInput[1]=keyThing.keystate(39)-keyThing.keystate(37); //turn
            currentRotateInput[2]=keyThing.keystate(69)-keyThing.keystate(81); //roll
			
			var viewScaleMultiplierTarget;
			if (activeGp){
					viewScaleMultiplierTarget = Math.pow(guiParams.holdZoomMagFactor,  activeGp.buttons[0].value - activeGp.buttons[1].value );	//	x4, x.25

					//zoom in/out a bit more WHILE holding some button (and return upon release)
					//A,B on xbox controller. TODO smooth transition. 

				//TODO move calculation of total input from keys/gamepad outside this loop
				//if (gpSettings.moveEnabled){
					var gpMove=[];
					var axes = activeGp.axes;
					var buttons = activeGp.buttons;
					
					gpMove[0] = Math.abs(axes[0])>gpSettings.deadZone ? -moveSpeed*axes[0] : 0; //lateral
					gpMove[1] = Math.abs(axes[1])>gpSettings.deadZone ? moveSpeed*axes[1] : 0; //vertical
					gpMove[2] = moveSpeed*(buttons[7].value-activeGp.buttons[6].value); //fwd/back	//note Firefox at least fails to support analog triggers https://bugzilla.mozilla.org/show_bug.cgi?id=1434408
					
					var magsq = gpMove.reduce(function(total, val){return total+ val*val;}, 0);
					gpMove = scalarvectorprod(20000000000*magsq,gpMove);	//TODO consistent speed with keyboard controls
					
					currentThrustInput = currentThrustInput.map(function(elem,idx){return elem-gpMove[idx];});
					
					//testInfo=[axes,buttons,gpMove,magsq];
					
					//note doing cube bodge to both thrust and to adding velocity to position (see key controls code)
					//maybe better to pick one! (probably should apply cube logic to acc'n for exponential smoothed binary key input, do something "realistic" for drag forces
				//}
				
				currentRotateInput[2]+=gpSettings.roll(activeGp); //roll
				
				//other rotation
				var gpRotate=[];
				var fixedRotateAmount = 10*rotateSpeed;
				gpRotate[0] = Math.abs(axes[gpSettings.pitchAxis])>gpSettings.deadZone ? fixedRotateAmount*gpSettings.pitchMultiplier*axes[gpSettings.pitchAxis] : 0; //pitch
				gpRotate[1] = Math.abs(axes[gpSettings.turnAxis])>gpSettings.deadZone ? fixedRotateAmount*gpSettings.turnMultiplier*axes[gpSettings.turnAxis] : 0; //turn
				gpRotate[2] = 0;	//moved to code above
					
				magsq = gpRotate.reduce(function(total, val){return total+ val*val;}, 0);
				var magpow = Math.pow(50*magsq,1.5);	//TODO handle fact that max values separately maxed out, so currently turns faster in diagonal direction.
				
				lastPlayerAngMove = scalarvectorprod(100000*magpow*timeStepMultiplier,gpRotate);
				rotatePlayer(lastPlayerAngMove);	//TODO add rotational momentum - not direct rotate
			}else{
				viewScaleMultiplierTarget=1;
			}
			if (viewScaleMultiplierTarget == 1){lockedViewMat=null;}
			viewScaleMultiplier = viewScaleMultiplier*0.95 + 0.05*viewScaleMultiplierTarget;


            for (var cc=0;cc<3;cc++){
				playerAngVelVec[cc]+= timeStepMultiplier*currentRotateInput[cc];
			//	playerVelVec[cc]+=currentThrustInput[cc];	//todo either write vector addition func or use glmatrix vectors

				for (var kk=0;kk<3;kk++){
					playerVelVec[cc]+=playerCamera[cc + 4*kk]*currentThrustInput[kk];
				}
            }
            
            playerAngVelVec=scalarvectorprod(angVelDampMultiplier,playerAngVelVec);


			rotatePlayer(scalarvectorprod(timeStep * rotateSpeed,playerAngVelVec));
			
			playerVelVec = scalarvectorprod(0.997,playerVelVec);	//drag
			movePlayer(scalarvectorprod(timeStep * moveSpeed,playerVelVec)); 
        }
    }

})();

function rotatePlayer(vec){
    //mat4.rotate(playerCamera, Math.hypot.apply(null, vec), vec3.create(vec));
    var myvec3 = vec3.create(vec);
    mat4.rotate(playerCamera, vec3.length(myvec3), myvec3);
        //glMatrix rotate seems inefficient. is there an option where pass in vector instead of the vector and its length?
}

function movePlayer(toMove){
	playerCamera[12]+=toMove[0];
	playerCamera[13]+=toMove[1];
	playerCamera[14]+=toMove[2];
}

//borrowed from 3sphere-explorer matfuncs.js
function scalarvectorprod(sca,vec){
	return vec.map(function(val){return sca*val;});
}

function drawObjectFromBuffers(bufferObj, shaderProg, usesCubeMap, drawMethod){
	prepBuffersForDrawing(bufferObj, shaderProg, usesCubeMap);
	drawObjectFromPreppedBuffers(bufferObj, shaderProg, drawMethod);
}

function prepBuffersForDrawing(bufferObj, shaderProg, usesCubeMap){
	enableDisableAttributes(shaderProg);	//TODO more this to shadersetup!!
	
	gl.bindBuffer(gl.ARRAY_BUFFER, bufferObj.vertexPositionBuffer);
    gl.vertexAttribPointer(shaderProg.attributes.aVertexPosition, bufferObj.vertexPositionBuffer.itemSize, gl.FLOAT, false, 0, 0);
	
	if (bufferObj.vertexNormalBuffer && shaderProg.attributes.aVertexNormal){
		gl.bindBuffer(gl.ARRAY_BUFFER, bufferObj.vertexNormalBuffer);
		gl.vertexAttribPointer(shaderProg.attributes.aVertexNormal, bufferObj.vertexNormalBuffer.itemSize, gl.FLOAT, false, 0, 0);
	}
	if (bufferObj.vertexTextureCoordBuffer && shaderProg.attributes.aTextureCoord){
		gl.bindBuffer(gl.ARRAY_BUFFER, bufferObj.vertexTextureCoordBuffer);
		gl.vertexAttribPointer(shaderProg.attributes.aTextureCoord, bufferObj.vertexTextureCoordBuffer.itemSize, gl.FLOAT, false, 0, 0);
		gl.uniform1i(shaderProg.uniforms.uSampler, 0);
	}
	
	gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, bufferObj.vertexIndexBuffer);

	if (usesCubeMap){
		gl.uniform1i(shaderProg.uniforms.uSampler, 1);	//put cubemap in tex 1 always, avoiding bind calls.
	}
	
	if (shaderProg.uniforms.uPMatrix){
		gl.uniformMatrix4fv(shaderProg.uniforms.uPMatrix, false, pMatrix);
	}
}

function drawObjectFromPreppedBuffers(bufferObj, shaderProg, drawMethod){
	if (shaderProg.uniforms.uMVMatrix){
		gl.uniformMatrix4fv(shaderProg.uniforms.uMVMatrix, false, mvMatrix);
	}
	drawMethod = drawMethod || gl.TRIANGLES;
	gl.drawElements(drawMethod, bufferObj.vertexIndexBuffer.numItems, gl.UNSIGNED_SHORT, 0);
}

var enableDisableAttributes = (function generateEnableDisableAttributesFunc(){
	var enabledSet = new Set();
	
	return function(shaderProg){
		
		var toBeEnabled = new Set();
		Object.keys(shaderProg.attributes).forEach(function(item, index){
			toBeEnabled.add(gl.getAttribLocation(shaderProg, item));	//TODO store attrib locations for shader at initialisation time?
		});
		
		enabledSet.forEach(item=>{
			if (!toBeEnabled.has(item)){
				enabledSet.delete(item);
				gl.disableVertexAttribArray(item);	
			}
		});
		
		toBeEnabled.forEach(item=>{
			if (!enabledSet.has(item)){
				enabledSet.add(item);
				gl.enableVertexAttribArray(item);	
			}
		});
	};
})();

var vrDisplay = null;

var frameData;
function setupVr(){
	
	if (!navigator.getVRDisplays) {
		console.log("no vr support");
		return;
	}
	frameData = new VRFrameData();

	var myvrbutton = document.getElementById("vrbutton");
	myvrbutton.addEventListener('click', (evt) => {
		console.log("button was clicked");
		onVRRequestPresent();
	})
	
	function onVRRequestPresent(){
		vrDisplay.requestPresent([{ source:canvas }]).then( () => {
			console.log("requestPresent promise fulfilled.");
			onResize();
        }, (err) => {
          console.log("requestPresent promise rejected..");
          if (err && err.message) {
            console.log(err.message);
          }
        });
	}

	function onVRExitPresent() {
        if (!vrDisplay.isPresenting)
          return;

        vrDisplay.exitPresent().then( () => {
			console.log("exitPresent promise fulfilled");
			onResize();
        }, (err) => {
			console.log("exitPresent promise rejected");
			if (err && err.message) {
			  console.log(err.message);
			}
        });
	}
	
	function onResize() {
		var newWidth, newHeight;
        if (vrDisplay && vrDisplay.isPresenting) {
		  console.log("resizing, display presenting.");

          var leftEye = vrDisplay.getEyeParameters("left");
		  var rightEye = vrDisplay.getEyeParameters("right");
		  newWidth = Math.max(leftEye.renderWidth, rightEye.renderWidth) * 2;
		  newHeight = Math.max(leftEye.renderHeight, rightEye.renderHeight);
		  console.log({leftEye, rightEye});

          canvas.width = Math.max(leftEye.renderWidth, rightEye.renderWidth) * 2;
          canvas.height = Math.max(leftEye.renderHeight, rightEye.renderHeight);
        } else {
		  console.log("resizing. no vr display, or vr display not presenting.");

		  newWidth =  webglCanvas.offsetWidth * window.devicePixelRatio;
          newHeight = webglCanvas.offsetHeight * window.devicePixelRatio;
		}
		console.log({newHeight, newWidth});
		canvas.height = newHeight;
		canvas.width = newWidth;
	}

	navigator.getVRDisplays().then(function (displays) {
		if (displays.length > 0) {
			console.log("vr displays detected: ", displays);
			//hope that only one vr display! TODO how to handle multiple? dropdown list?

			vrDisplay = displays[displays.length-1];
				//copied from webvr examples. if one, could just as well use displays[0]
			console.log("selected display: ", vrDisplay);
		}else{
			console.log("zero vr displays");
		}
	});
}