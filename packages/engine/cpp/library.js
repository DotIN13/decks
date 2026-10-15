// What the page needs from Emscripten's own tables to hand the engine its GPU objects: a WebGPU
// texture view imported as a handle the C++ side can use, and a WebGL texture given a GL name.
addToLibrary({
	engine_bridge__deps: ["$WebGPU", "$GL"],
	engine_bridge__postset: "Module['engineBridge'] = _engine_bridge;",
	engine_bridge: () => ({
		importView: (view) => WebGPU.importJsTextureView(view),
		glContext: (handle) => GL.getContext(handle)?.GLctx,
		glRegister: (texture) => {
			const id = GL.getNewId(GL.textures);
			texture.name = id;
			GL.textures[id] = texture;
			return id;
		},
		glForget: (id) => {
			GL.textures[id] = null;
		},
	}),
});
