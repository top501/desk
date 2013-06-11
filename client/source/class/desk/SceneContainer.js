/**
* A widget containing a THREE.scene to visualize 3D meshes
* 
* @asset(desk/camera-photo.png)
* @ignore(THREE.Mesh)
* @ignore(THREE.Vector2)
* @ignore(THREE.Vector3)
* @ignore(THREE.Face4)
* @ignore(THREE.DoubleSide)
* @ignore(THREE.Projector)
* @ignore(THREE.Raycaster)
* @ignore(THREE.VTKLoader)
* @ignore(THREE.Geometry)
* @ignore(THREE.MeshPhongMaterial)
* @ignore(THREE.Color)
* @ignore(THREE.CTMLoader)
* @ignore(requestAnimationFrame)
* @ignore(Detector)
* @ignore(Uint8Array)
* @lint ignoreDeprecated(alert)
* @ignore(desk.MeshTools)
* @ignore (THREE.ParticleSystem)
* @ignore (THREE.Line)
* @ignore (async.queue)
* @ignore (async.each)
*/
qx.Class.define("desk.SceneContainer", 
{
    extend : qx.ui.splitpane.Pane,
	include : desk.LinkMixin,

	construct : function(file, parameters, callback, context)
	{
        this.base(arguments);
        this.__files = [];

        this.setOrientation("horizontal");
        parameters = parameters || {};

		if (parameters.convertVTK !== undefined) {
			this.setConvertVTK(parameters.convertVTK);
		}

		var elementsList = new qx.ui.container.Composite();
		elementsList.setLayout(new qx.ui.layout.VBox(3));
		this.add(elementsList, 1);
		elementsList.setVisibility("excluded");

        this.__threeContainer = new desk.ThreeContainer();
		this.add(this.__threeContainer, 5);
		this.__setupInteractions();
		var button=new qx.ui.form.Button("+").set({opacity : 0.5});
		this.__threeContainer.add (button, {left : 3, top : 3});
		button.addListener("execute", function () {
			if (elementsList.getVisibility()=="visible") {
				elementsList.setVisibility("excluded");
				button.setLabel("+");
				this.render();
			}
			else {
				elementsList.setVisibility("visible");
				button.setLabel("-");
				this.render();
			}
		}, this);

		var topRightContainer = new qx.ui.container.Composite();
		topRightContainer.setLayout(new qx.ui.layout.HBox());
		elementsList.add(topRightContainer);
		topRightContainer.add(this.__getDragLabel());
		topRightContainer.add(this.__getResetViewButton(), {flex : 1});
		topRightContainer.add(this.__getSnapshotButton());

		this.__meshesTree = new qx.ui.treevirtual.TreeVirtual(["meshes"]);
		this.__meshesTree.setSelectionMode(qx.ui.treevirtual.TreeVirtual.SelectionMode.MULTIPLE_INTERVAL);
		this.__meshesTree.set({
			width  : 180,
			rowHeight: 22,
			columnVisibilityButtonVisible : false,
            statusBarVisible : false		
		});

        elementsList.add(this.__meshesTree,{flex : 1});
		elementsList.add(this.__getFilterContainer());

		this.__meshesTree.setContextMenu(this.__getContextMenu());

		this.__ctmLoader = new THREE.CTMLoader(this.__threeContainer.getRenderer().context);
		this.__vtkLoader = new THREE.VTKLoader();

		this.__queue= async.queue(this.__urlLoad.bind(this), 10);

		var self = this;
		this.__setData = _.throttle(function () {
				self.__meshesTree.getDataModel().setData();
			}, 2000)


		if (file) {
			this.addFile(file, parameters, callback, context);
			window.setCaption(file);
		}
		this.__addDropSupport();
	},

	destruct : function(){
		this.fireEvent("close");
		// this hack helps avoiding assertion errors when calling removeAllMeshes (to debug...)
		this.__destructorHack = true;
		this.removeAllMeshes();
		this.unlink();
		var children = this.getChildren();
		this.__meshesTree.dispose();
		this.__meshesTree.getDataModel().dispose();
		qx.util.DisposeUtil.destroyContainer(children[0]);
		qx.util.DisposeUtil.destroyContainer(children[1]);
		this.__ctmLoader = null;
	},

	properties : {
		convertVTK : {init : true, check: "Boolean"}
	},

	events : {
		"close" : "qx.event.type.Event",
		/**
		 * Fired whenever a mesh is removed. Attached data is the removed mesh
		 */
		"meshRemoved" : "qx.event.type.Data"
		},

	members : {
		// array containing all loaded meshes
        __files : null,

		// the scene container
		__threeContainer : null,
		
		// a treeVirtual element storing all meshes
		__meshesTree : null,

		// a async.queue to load meshes
		__queue : null,

		// a THREE.VTKLoader
        __vtkLoader : null,

		// a THREE.CTMLLoader
        __ctmLoader : null,

		__setData : null,

		getThreeContainer : function () {
			return this.__threeContainer;
		},

		getScene : function() {
			return this.__threeContainer.getScene();
		},

		applyAfterEachRendering : function (callback, context) {
			this.__threeContainer.addListener('render', callback, context);
		},

		getMeshes : function() {
			var meshes = [];
			var scene = this.__threeContainer.getScene();
			if (scene) {
				scene.traverse(function(child){
					if ((child instanceof THREE.Mesh) ||
						(child instanceof THREE.ParticleSystem) ||
						(child instanceof THREE.Line)) {
						meshes.push(child);
					}
				});
			}
			return meshes;
		},

        __addLeaf : function (parameters) {
			parameters = parameters || {};
			var dataModel = this.__meshesTree.getDataModel();
			parameters.label = parameters.label || "mesh";
			var parent = parameters.parent;
			var leaf = dataModel.addLeaf(parent, parameters.label, null);
			this.__setData();
			return leaf;
		},

		__getMeshFromNode : function (node) {
			var leaf = this.__meshesTree.nodeGet(node);
			if (leaf) {
				if (leaf.__customProperties) {
					return leaf.__customProperties.mesh;
				}
			}
			return null;
		},

		addMesh : function (mesh, parameters) {
			parameters = parameters || {};
			this.__threeContainer.getScene().add(mesh);
			var leaf = parameters.leaf;
			if (leaf === undefined) {
				parameters.leaf = leaf = this.__addLeaf(parameters);
			}
			parameters.mesh = mesh;
			this.__meshesTree.nodeGet(leaf).__customProperties = parameters;
			mesh.__customProperties = parameters;
		},

		viewAll : function () {
			this.__threeContainer.viewAll();
		},

		__getFilterContainer : function () {
			var dataModel = this.__meshesTree.getDataModel();
			var container = new qx.ui.container.Composite();
			container.setLayout(new qx.ui.layout.HBox(10));
			var filterText = new qx.ui.basic.Label("search");
			container.add(filterText);

			var filterField = new qx.ui.form.TextField();
			filterField.setValue("");
			filterField.addListener("input", function() {
				this.__setData();
				this.render();
			}, this);
			container.add(filterField);

			var filter = qx.lang.Function.bind(function(node) {
				if (node.type == qx.ui.treevirtual.MTreePrimitive.Type.LEAF) {
					var label = node.label;
					var mesh = this.__getMeshFromNode(node);
					var visibility = false;
					if (label.toLowerCase().indexOf(filterField.getValue().toLowerCase()) != -1) {
						visibility = true;
					}
					if (mesh) {
						mesh.visible = visibility;
					}
					return visibility;
				}
				return true;
			}, this);

			var resetButton = new qx.ui.form.Button("Reset filter");
			resetButton.setAllowGrowY(false);
			resetButton.addListener("execute",function(e){
				filterField.setValue("");
				this.__setData();
				this.render();
			}, this);

			container.add(resetButton);
			dataModel.setFilter(filter);
			return container;
		},

		__readFile : function (file, parameters, callback) {
            parameters = parameters || {};
			var label = desk.FileSystem.getFileName(file);
			var leafParameters = {label : label};
			leafParameters.parent = parameters.parent;
            var leaf = this.__addLeaf(leafParameters);
            parameters.leaf = leaf;

			var extension = desk.FileSystem.getFileExtension(file);
			switch (extension)
			{
            case "vtk":
				if (!this.isConvertVTK()) {
					this.__loadFile(file, parameters, callback);
					break;
				}
			case "ply":
			case "obj":
			case "stl":
			case "off":
				desk.Actions.getInstance().launchAction({
                    "action" : "mesh2ctm",
					"input_mesh" : file,
					"output_directory" : 'cache/'},
                    function (response) {
                       var outputDir = response.outputDirectory;
                        parameters.mtime = response.MTime;
                        this.__loadFile(outputDir + '/mesh.ctm', parameters, callback);
				}, this);
				break;

			case "ctm":
				this.__loadFile(file, parameters, callback);
				break;
			default : 
				alert("error : file " + file + " cannot be displayed by mesh viewer");
			}
		},

		__loadFile : function (file, parameters, callback) {
			parameters.mtime = parameters.mtime || Math.random();
			parameters.url = desk.FileSystem.getFileURL(file) + "?nocache=" + parameters.mtime;
			this.loadURL(parameters, callback);
		},


		update : function () {
            var files = this.__files;
            this.__files = [];
			this.removeAllMeshes();
            this.__meshesTree.getDataModel().clearData();
            for (var i = 0; i < files.length ; i++) {
                this.addFile(files[i]);
            }
		},

		__propagateLinks : function () {
			this.applyToOtherLinks(function (me) {
				var controls = this.__threeContainer.getControls();
				controls.copy(me.__threeContainer.getControls());
				controls.update();
				this.render();
			});
		},

		removeAllMeshes : function () {
			this.removeMeshes(this.getMeshes());
			this.__threeContainer.resetView();
		},

		__parseXMLData : function (file, rootDocument, parameters, callback) {
			var meshes = rootDocument.getElementsByTagName("mesh");
			var rootElement = rootDocument.childNodes[0];
			if (rootElement.hasAttribute("timestamp")) {
				parameters.mtime = parseFloat(rootElement.getAttribute("timestamp"));
			} else {
				parameters.mtime = Math.random();
			}

			var dataModel = this.__meshesTree.getDataModel();
			var leaf = dataModel.addBranch(null, desk.FileSystem.getFileName(file), null);
			this.__setData();

			var path = desk.FileSystem.getFileDirectory(file);
			var self = this;
			async.each(meshes, function (mesh, callback) {
				var meshParameters = {parent : leaf};
				if (mesh.hasAttribute("color")) {
					var colorstring = mesh.getAttribute("color");
					var colors = colorstring.split(" ");
					var color = [];
					while (colors.length < 3) {
						colors.push('1');
					}
					if (colors.length < 4) {
						colors.push('1');
					}
					
					if ( colors.length < 5) {
						colors.push('0');
					}
					
					for (var j = 0; j < 4; j++) {
						color[j] = parseFloat(colors[j]);
					}
					color[4] = parseInt(colors[4], 10);
					meshParameters.color = color;
				}

				var xmlName;
				if (mesh.hasAttribute("Mesh")) {
					xmlName = mesh.getAttribute("Mesh");
				} else {
					xmlName = mesh.getAttribute("mesh");
				}
				self.__readFile(path + "/" + xmlName, meshParameters, callback);
			}, function (err, result) {
				if (typeof callback == "function") {
					callback();
				}
			});
		},

		/**
		 * Loads a file in the scene.
		 * @param file {String} input file
		 * @param parameters {Object} optionnal display options
		 * @param callback {Function} callback when done
		 * @param context {Object} optional context for the callback
		 */
		addFile : function (file, parameters, callback, context) {
            parameters = parameters || {};
            this.__files.push(file);
            parameters.file = file;

			function afterLoading(mesh) {
				if (typeof callback === 'function') {
					callback.apply(context, [mesh]);
				}
			}

            var extension = desk.FileSystem.getFileExtension(file);
			switch (extension)
			{
				case "ply":
				case "obj":
				case "stl":
				case "vtk":
				case "ctm":
				case "off":
					this.__readFile (file, parameters, afterLoading);
					break;
				case "xml":
					desk.FileSystem.readFile(file, function (error, result){
						this.__parseXMLData(file, result, parameters, callback);
					}, this);
					break;
				default : 
					alert ("error : meshviewer cannot read extension " + extension);
					break;
			}
		},

		/**
		 * Attaches a set of desk.VolumeSlice to the scene
		 * @param volumeSlices {Array} Array of deskVolumeSlice;
		 * @return {Array} array of THREE.Mesh
		 */
		attachVolumeSlices : function (volumeSlices) {
			var meshes = [];
			for (var i = 0; i < volumeSlices.length; i++) {
				meshes.push(this.attachVolumeSlice(volumeSlices[i]));
			}
			return meshes;
		},

		/**
		 * Attaches a set of desk.VolumeSlice to the scene
		 * @param volumeSlice {desk.VolumeSlice} volume slice to attach;
		 * @return {THREE.Mesh} the created mesh;
		 */
		attachVolumeSlice : function (volumeSlice) {
			var geometry = new THREE.Geometry();
			geometry.dynamic = true;
			for (var i = 0; i < 4; i++) {
				geometry.vertices.push(new THREE.Vector3(0, 0, 0));
			}
			geometry.faces.push(new THREE.Face4(0, 1, 2, 3));
			geometry.faceVertexUvs[0].push([
				new THREE.Vector2(0, 0),
				new THREE.Vector2(1, 0),
				new THREE.Vector2(1, 1),
				new THREE.Vector2(0, 1)
			]);

			var material = volumeSlice.getMaterial();
			material.side = THREE.DoubleSide;
			var mesh = new THREE.Mesh(geometry,material);

			function updateTexture() {
				var coords = volumeSlice.getCornersCoordinates();
				for (var i = 0; i < 4; i++) {
					geometry.vertices[i].set(coords[3*i], coords[3*i+1], coords[3*i+2]);
				}
				geometry.computeFaceNormals();
				geometry.computeBoundingSphere();
				geometry.verticesNeedUpdate = true;
				this.render(true);
			}

			var listenerId = volumeSlice.addListener('changeImage', updateTexture, this);
            this.addMesh(mesh, {label : 'View ' + (volumeSlice.getOrientation()+1),
				listenerId : listenerId,
                volumeSlice : volumeSlice
            });
			updateTexture.apply(this);
			return mesh;
		},

		__addDropSupport : function () {
			this.setDroppable(true);
			this.addListener("drop", function(e) {
				if (e.supportsType("fileBrowser")) {
					var files = e.getData("fileBrowser").getSelectedFiles();
					for (var i = 0; i < files.length; i++) {
						this.addFile(files[i]);
					}
				}
				if (e.supportsType("volumeSlices")) {
					this.attachVolumeSlices(e.getData("volumeSlices"));
				}
			}, this);
		},

		__draggingInProgress : false,

		__onMouseDown : function (event) {
			this.__threeContainer.capture();
			var origin = this.__threeContainer.getContentLocation();
			this.__draggingInProgress = true;
			var button = 0;
			if (event.isRightPressed() || 
				(event.isCtrlPressed() && !event.isShiftPressed())) {
				button = 1;
			}
			else if ( event.isMiddlePressed() ||
				(event.isShiftPressed() && !event.isCtrlPressed())) {
				button = 2;
			}
			else if (event.isCtrlPressed() && event.isShiftPressed()) {
				button = 3;
			}

			this.__threeContainer.getControls().mouseDown(button,
							event.getDocumentLeft() - origin.left,
							event.getDocumentTop() - origin.top);
		},

		__onMouseMove : function (event) {
			if (this.__draggingInProgress) {
				var origin = this.__threeContainer.getContentLocation();
				this.__threeContainer.getControls().mouseMove(event.getDocumentLeft() - origin.left,
					event.getDocumentTop() - origin.top);
				this.render();
				this.__propagateLinks();
			}
		},

		__onMouseUp : function (event) {
			this.__threeContainer.releaseCapture();
			this.__draggingInProgress = false;
			this.__threeContainer.getControls().mouseUp();
		},

		__onMouseWheel : function (event) {
			var tree = this.__meshesTree;
			var children = [];
			this.__threeContainer.getScene().traverse(function (object){
				if (!object.__customProperties) {
					return;
				}

				if (object.__customProperties.volumeSlice) {
					children.push(object);
				}
			});
			if (children.length !== 0) {
				var meshes = [];
				for (var i = 0; i < children.length; i++) {
					var mesh = children[i];
					if (mesh.visible) {
						meshes.push(mesh);
					}
				}

				var origin = this.__threeContainer.getContentLocation();
				var x=event.getDocumentLeft() - origin.left;
				var y=event.getDocumentTop() - origin.top;

				var elementSize = this.__threeContainer.getInnerSize();
				var x2 = ( x / elementSize.width ) * 2 - 1;
				var y2 = - ( y / elementSize.height ) * 2 + 1;

				var projector = new THREE.Projector();
				var vector = new THREE.Vector3( x2, y2, 0.5 );
				var camera = this.__threeContainer.getCamera();
				projector.unprojectVector(vector, camera);

				var ray = new THREE.Raycaster(camera.position,
					vector.sub(camera.position).normalize());

				var intersects = ray.intersectObjects(meshes);

				if (intersects.length > 0) {
					var volumeSlice = intersects[0].object.__customProperties.volumeSlice;
					var maximum = volumeSlice.getNumberOfSlices() - 1;
					var delta = Math.round(event.getWheelDelta()/2);
					var newValue = volumeSlice.getSlice() + delta;
					if (newValue > maximum) {
						newValue = maximum;
					}
					if (newValue < 0) {
						newValue = 0;
					}
					volumeSlice.setSlice(newValue);
				}
			}
		},

		__setupInteractions : function() {
			this.__threeContainer.addListener("mousedown", this.__onMouseDown, this);
			this.__threeContainer.addListener("mousemove", this.__onMouseMove, this);
			this.__threeContainer.addListener("mouseup", this.__onMouseUp, this);
			this.__threeContainer.addListener("mousewheel", this.__onMouseWheel, this);
		},

		/**
		 * Renders the scene
		 * @param force {Boolean} when true, the rendering will be immediate
		 * (no wait for resquestAnimationFrame)
		 */
		render : function (force) {
			this.__threeContainer.render(force);
		},

		loadURL : function (parameters, callback) {
			this.__queue.push(parameters, callback);
		},

        addGeometry : function (geometry, parameters) {
            parameters = parameters || {label : 'geometry'};
			geometry.dynamic = true;
			geometry.computeBoundingBox();

			var color = parameters.color || [];
            for (var i = color.length; i < 3; i++) {
                color.push(1);
            }
            if (color.length < 4) {
                color.push(1);
            }
            if (color.length < 5) {
                color.push(0);
            }
			var threecolor = new THREE.Color().setRGB(color[0],color[1],color[2]);

			var material =  new THREE.MeshPhongMaterial({
                color : threecolor.getHex(),
                opacity : color[3]
            });
			var factor = 0.3;
			material.ambient = new THREE.Color().setRGB(
				factor*threecolor.r,factor*threecolor.g,factor*threecolor.b);
			material.shininess = 5;
			material.specular = new THREE.Color( 0x303030 );
			if (color[3] < 0.999) {
				material.transparent = true;
			}
            material.side = THREE.DoubleSide;
			var mesh = new THREE.Mesh(geometry, material );
			mesh.renderDepth = color[4];
            this.addMesh( mesh, parameters );
			this.viewAll();
            return mesh;
        },

		__urlLoad : function (parameters, callback) {
			var useWorker = true;
			var useBuffers = true;

			var self = this;
			if (parameters.useBuffers === false) {
				useBuffers = false;
			}
			var loader;
			if (desk.FileSystem.getFileExtension(parameters.url) === "vtk") {
				loader = this.__vtkLoader;
			} else {
				loader = this.__ctmLoader;
			}

			loader.load (parameters.url, function (geometry) {
				var mesh = self.addGeometry(geometry, parameters);
				if (typeof callback === 'function') {
					callback(mesh);
				}
			}, { useWorker : useWorker, useBuffers : useBuffers});
		},

		__getSnapshotButton : function () {
			var factor=1;
			var menu = new qx.ui.menu.Menu();
			var x1button = new qx.ui.menu.Button("x1");
			x1button.addListener("execute", function (){factor=1;},this);
			menu.add(x1button);
			var x2button = new qx.ui.menu.Button("x2");
			x2button.addListener("execute", function (){factor=2;},this);
			menu.add(x2button);
			var x3button = new qx.ui.menu.Button("x3");
			x3button.addListener("execute", function (){factor=3;},this);
			menu.add(x3button);
			var x4button = new qx.ui.menu.Button("x4");
			x4button.addListener("execute", function (){factor=4;},this);
			menu.add(x4button);

			var button=new qx.ui.form.Button(null, "desk/camera-photo.png");
			button.addListener("execute", function(e) {
				this.__threeContainer.snapshot(factor);
			}, this);

			button.setContextMenu(menu);
			qx.util.DisposeUtil.disposeTriggeredBy(menu, this);
			return button;
		},

		__getResetViewButton : function () {
			var button = new qx.ui.form.Button("reset view");
			button.addListener("execute", this.__threeContainer.resetView,
				this.__threeContainer);
			return button;
		},

		__getDragLabel : function () {q
			var dragLabel = new qx.ui.basic.Label("Link").set({decorator: "main"});
			// drag and drop support
			dragLabel.setDraggable(true);
			dragLabel.addListener("dragstart", function(e) {
				e.addAction("alias");
				e.addType("meshView");
				});

			dragLabel.addListener("droprequest", function(e) {
					var type = e.getCurrentType();
					if (type === "meshView") {
						e.addData(type, this);
					}
				}, this);

			// enable linking between viewers by drag and drop
			this.setDroppable(true);
			this.addListener("drop", function(e) {
				if (e.supportsType("meshView")) {
					var meshView=e.getData("meshView");
					this.link(meshView);
					meshView.__propagateLinks();
				}
			},this);

			var menu = new qx.ui.menu.Menu();

			var unlinkButton = new qx.ui.menu.Button("unlink");
			unlinkButton.addListener("execute", this.unlink, this);
			menu.add(unlinkButton);
			dragLabel.setContextMenu(menu);
			qx.util.DisposeUtil.disposeTriggeredBy(menu, this);
			return dragLabel;
		},

		__getPropertyWidget : function (parentWindow){
			var meshesTree=this.__meshesTree;
			
			var mainContainer = new qx.ui.container.Composite();
			mainContainer.setLayout(new qx.ui.layout.VBox());

			var topBox = new qx.ui.container.Composite();
			topBox.setLayout(new qx.ui.layout.HBox());
			var bottomBox = new qx.ui.container.Composite();
			bottomBox.setLayout(new qx.ui.layout.HBox());
			mainContainer.add(topBox);
			mainContainer.add(bottomBox);

			var colorSelector=new qx.ui.control.ColorSelector();
			bottomBox.add(colorSelector);//, {flex:1});

/*			var wireframeCheckBox=new qx.ui.form.CheckBox("wireframe");
			topBox.add(wireframeCheckBox);
		*/	

			var renderDepthLabel=new qx.ui.basic.Label("Render Depth");
			topBox.add(renderDepthLabel);

			var renderDepthSpinner=new qx.ui.form.Spinner(-100, 0,100);
			topBox.add(renderDepthSpinner);

			topBox.add(new qx.ui.core.Spacer(10, 20),{flex:1});
			if (parentWindow) {
				var alwaysOnTopCheckBox=new qx.ui.form.CheckBox("this window always on top");
				alwaysOnTopCheckBox.setValue(true);
				parentWindow.setAlwaysOnTop(true);
				alwaysOnTopCheckBox.addListener('changeValue',function (e){
					parentWindow.setAlwaysOnTop(alwaysOnTopCheckBox.getValue());
					});
				topBox.add(alwaysOnTopCheckBox);
			}
			var ratio=255;
			var opacitySlider=new qx.ui.form.Slider();
			opacitySlider.setMinimum(0);
			opacitySlider.setMaximum(ratio);
			opacitySlider.setWidth(30);
			opacitySlider.setOrientation("vertical");
			bottomBox.add(opacitySlider);

			var enableUpdate = true;
			var updateWidgets = function (event) {
				enableUpdate = false;
				var selectedNode = meshesTree.getSelectedNodes()[0];
				if (selectedNode.type === qx.ui.treevirtual.MTreePrimitive.Type.LEAF) {
					var firstSelectedMesh = this.__getMeshFromNode(selectedNode);
					var color=firstSelectedMesh.material.color;
					colorSelector.setRed(Math.round(ratio*color.r));
					colorSelector.setGreen(Math.round(ratio*color.g));
					colorSelector.setBlue(Math.round(ratio*color.b));
					colorSelector.setPreviousColor(Math.round(ratio*color.r),
							Math.round(ratio*color.g),Math.round(ratio*color.b));
			//		wireframeCheckBox.setValue(firstSelectedMesh.material.wireframe);
					opacitySlider.setValue(Math.round(firstSelectedMesh.material.opacity*ratio));
                    if (firstSelectedMesh.renderDepth) {
                        renderDepthSpinner.setValue(firstSelectedMesh.renderDepth);
                    }
					enableUpdate=true;
				}
			};
			
			updateWidgets.apply(this);

			meshesTree.addListener("changeSelection",updateWidgets, this);

			opacitySlider.addListener("changeValue", function(event){
				if (enableUpdate) {
					var opacity=opacitySlider.getValue()/ratio;
                    this.applyToSelectedMeshes(function (mesh){
						mesh.material.opacity=opacity;
						if (opacity<1) {
							mesh.material.transparent=true;
						} else {
							mesh.material.transparent=false;
						}
                    });
					this.render();
				}
			}, this);

			colorSelector.addListener("changeValue", function(event){
				if (enableUpdate) {
                    this.applyToSelectedMeshes(function (mesh){
						mesh.material.color.setRGB (colorSelector.getRed()/ratio,
									colorSelector.getGreen()/ratio,
									colorSelector.getBlue()/ratio);
					});
					this.render();
				}
			}, this);

/*			wireframeCheckBox.addListener('changeValue',function(event){
				if (enableUpdate)
				{
					var shapesArray=meshesTree.getSelectedNodes();
					for (var i=0;i<shapesArray.length;i++)
					{
						var shape=this.__meshes[shapesArray[i].nodeId];
						shape.material.wireframe=wireframeCheckBox.getValue();
					}
					console.log(wireframeCheckBox.getValue());
					this.render();
				}
				}, this);*/

			renderDepthSpinner.addListener("changeValue", function(event){
				if (enableUpdate) {
                    this.applyToSelectedMeshes(function (mesh){
                        mesh.renderDepth=renderDepthSpinner.getValue();
                    });
					this.render();
				}
			}, this);
			return (mainContainer);
		},

        getSelectedMeshes : function () {
            var nodes = this.__meshesTree.getSelectedNodes();
            var meshes = [];
			for (var i = 0; i < nodes.length; i++) {
                var mesh = this.__getMeshFromNode(nodes[i]);
                if (mesh) {
                    meshes.push(mesh);
                }
			}
            return meshes;
        },

        applyToSelectedMeshes : function (iterator) {
			var meshes = this.getSelectedMeshes();
			for (var i = 0; i < meshes.length; i++) {
                iterator(meshes[i]);
			}
        },

		removeMeshes : function (meshes) {
			for (var i=0;i<meshes.length;i++) {
				this.removeMesh(meshes[i]);
			}
		},

		__destructorHack : false,

        removeMesh : function (mesh) {
			var renderer = this.__threeContainer.getRenderer();
			var dataModel = this.__meshesTree.getDataModel();
			var parameters = mesh.__customProperties;

			var keepGeometry = false;
			var keepMaterial = false;

			if (parameters) {
				var leaf = parameters.leaf;
				delete leaf.__customProperties;
				dataModel.prune(leaf, true);
				parameters.mesh = 0;
				// test if mesh is actually a volume slice
				var volumeSlice = parameters.volumeSlice;
				if (volumeSlice) {
					volumeSlice.removeListenerById(parameters.listenerId);
				}
				delete mesh.__customProperties;
				if (!this.__destructorHack) {
					// hack to avoid assertion errors (to debug...)
					this.__setData();
				}
				keepGeometry = parameters.keepGeometry;
				keepMaterial = parameters.keepMaterial;
			}

			this.__threeContainer.getScene().remove(mesh);
			if (!keepGeometry) {
				mesh.geometry.dispose();
			}
			if (!keepMaterial) {
				var map = mesh.material.map;
				if (map) {
					map.dispose();
				}
				mesh.material.dispose();
			}
			this.fireDataEvent("meshRemoved", mesh);
        },

		__animator : null,

		__getContextMenu : function() {
			//context menu to edit meshes appearance
			var menu = new qx.ui.menu.Menu();

			var propertiesButton = new qx.ui.menu.Button("properties");
			propertiesButton.addListener("execute", function (){
				var node = this.__meshesTree.getSelectedNodes()[0];
				var mesh = this.__getMeshFromNode(node);
				alert ("Mesh with "+mesh.geometry.attributes.position.numItems/3+" vertices and "+
						mesh.geometry.attributes.index.numItems/3+" polygons");
			}, this);
			menu.add(propertiesButton);

			var appearanceButton = new qx.ui.menu.Button("appearance");
			appearanceButton.addListener("execute", function (){
				var propertyWindow = new qx.ui.window.Window();
				propertyWindow.setLayout(new qx.ui.layout.HBox());
				propertyWindow.add(this.__getPropertyWidget(propertyWindow));
				propertyWindow.open();
				propertyWindow.addListener('close', function () {
					qx.util.DisposeUtil.destroyContainer(propertyWindow.getChildren()[0]);
					propertyWindow.destroy();
				});
			}, this);
			menu.add(appearanceButton);

			var showButton = new qx.ui.menu.Button("show");
			showButton.addListener("execute", function (){
                this.applyToSelectedMeshes(function (mesh) {
                        mesh.visible = true;
                });
				this.render();
			},this);
			menu.add(showButton);

			var hideButton = new qx.ui.menu.Button("hide");
			hideButton.addListener("execute", function (){
                this.applyToSelectedMeshes(function (mesh) {
                        mesh.visible = false;
                });
				this.render();
			},this);
			menu.add(hideButton);

			var removeButton = new qx.ui.menu.Button("remove");
			removeButton.addListener("execute", function (){
				this.removeMeshes(this.getSelectedMeshes());
				this.render();		
			},this);
			menu.add(removeButton);
			
			var analysisButton = new qx.ui.menu.Button("Mesh Tools");
			analysisButton.addListener("execute", function (){
				var meshes=this.__meshesTree.getSelectedNodes();
				for (var i=0;i<meshes.length;i++) {
					if (meshes[i].type == qx.ui.treevirtual.MTreePrimitive.Type.LEAF) {
						var meshId=meshes[i].nodeId;
						var mesh=this.getMeshes()[meshId];
						var meshTools = new desk.MeshTools( {meshViewer:this, specMesh:mesh} );
					}
				}
			},this);
			menu.add(analysisButton);
			
			var animateButton = new qx.ui.menu.Button('animate');
			animateButton.addListener('execute', function () {
				var nodes = this.__meshesTree.getSelectedNodes();
				if (!this.__animator) {
					this.__animator = new desk.Animator(this);
					this.__animator.addListener('close', function () {
						this.__animator = null;
					}, this);
				}

				for (var i = 0; i !=nodes.length; i++) {
                    var node = nodes[i];
					this.__animator.addObject(this.__getMeshFromNode(node), node.label);
				}
			},this);
			menu.add(animateButton);
			
			var optionalButtons = [propertiesButton, appearanceButton,
				analysisButton, animateButton];
			
			//// hide all menu buttons but the "show" and "hide" buttons for the volumeSlices
			menu.addListener("appear", function() {
				var nodes = this.__meshesTree.getSelectedNodes();
				if (!nodes) {
					return;
				}
				var selNode = nodes[0];
				if (!selNode) {
					return;
				}
				var leaf = this.__meshesTree.nodeGet(selNode);
				var visibility = "visible";
				if (leaf) {
					if (leaf.__customProperties) {
						if(leaf.__customProperties.volumeSlice) {
							visibility = "excluded";
						}
					}
				}
				for (var i = 0; i < optionalButtons.length; i++) {
					optionalButtons[i].setVisibility(visibility);
				}
			}, this);

			qx.util.DisposeUtil.disposeTriggeredBy(menu, this);
			return menu;
		}
	}
});
