import { EngineContext } from "./EngineContext.js"
import { CanvasContext } from "./CanvasContext.js"

const shader_load_slice =`
@group(0) @binding(0)
var<uniform> uRange: vec2f;

@group(0) @binding(1) 
var uSampler: sampler;

@group(0) @binding(2)
var uTex: texture_2d<f32>;

struct VSOut 
{
    @builtin(position) Position: vec4f,
    @location(0) vUV: vec2f
};

@vertex
fn vs_main(@builtin(vertex_index) vertId: u32) -> VSOut 
{
    var vsOut: VSOut;
    let grid = vec2(f32((vertId<<1)&2), f32(vertId & 2));
    let pos_proj = grid * vec2(2.0, 2.0) + vec2(-1.0, -1.0);    
    vsOut.vUV = vec2(grid.x, 1.0 -grid.y);
    vsOut.Position = vec4(pos_proj, 0.0, 1.0);
    return vsOut;
}


@fragment
fn fs_main(@location(0) vUV: vec2f) -> @location(0) vec4f
{
    let v_in = textureSampleLevel(uTex, uSampler, vUV, 0.0).x;
    let v_out = v_in*(uRange.y-uRange.x) + uRange.x;
    return vec4(v_out);
}
`;

class LoadSlice
{
    constructor(width, height)
    {
        this.width = width;
        this.height = height;

        this.src_tex = engine_ctx.device.createTexture({
            size: { width, height},
            dimension: "2d",
            format: 'r8unorm',
            usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
        });

        this.dst_tex = engine_ctx.device.createTexture({
            size: { width, height},
            dimension: "2d",
            format: 'r16float',
            usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC
        });

        this.src_view = this.src_tex.createView();
        this.dst_view =  this.dst_tex.createView();
        this.constant = engine_ctx.createBuffer0(16, GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST);
        this.sampler = engine_ctx.device.createSampler({});

        if (!("load_slice" in engine_ctx.cache.bindGroupLayouts))
        {
            engine_ctx.cache.bindGroupLayouts.load_slice = engine_ctx.device.createBindGroupLayout({
                entries: [
                    {
                        binding: 0,
                        visibility: GPUShaderStage.FRAGMENT,
                        buffer:{
                            type: "uniform"
                        }
                    },
                    {
                        binding: 1,
                        visibility: GPUShaderStage.FRAGMENT,
                        sampler:{}
                    },
                    {
                        binding: 2,
                        visibility: GPUShaderStage.FRAGMENT,
                        texture:{
                            viewDimension: "2d"
                        }
                    }
                ]
            });
        }

        const bindGroupLayout = engine_ctx.cache.bindGroupLayouts.load_slice;
        this.bind_group = engine_ctx.device.createBindGroup({
            layout: bindGroupLayout,
            entries: [
                {
                    binding: 0,
                    resource:{
                        buffer: this.constant
                    }
                },
                {
                    binding: 1,
                    resource: this.sampler
                },
                {
                    binding: 2,
                    resource: this.src_view 
                }
            ]
        });

        const pipelineLayoutDesc = { bindGroupLayouts: [engine_ctx.cache.bindGroupLayouts.load_slice] };
        this.layout = engine_ctx.device.createPipelineLayout(pipelineLayoutDesc);
        this.shaderModule = engine_ctx.device.createShaderModule({code: shader_load_slice});

        const vertex = {
            module: this.shaderModule,
            entryPoint: 'vs_main',
            buffers: []
        };

        const colorState = {
            format: 'r16float',
            writeMask: GPUColorWrite.ALL
        };

        const fragment = {
            module: this.shaderModule,
            entryPoint: 'fs_main',
            targets: [colorState]
        };

        const primitive = {
            frontFace: 'cw',
            cullMode: 'none',
            topology: 'triangle-list'
        };

        const pipelineDesc = {
            layout: this.layout,
    
            vertex,
            fragment,
    
            primitive,
        };

        this.pipeline = engine_ctx.device.createRenderPipeline(pipelineDesc);

    }

    load_slice(low, high)
    {
        const uniform = new Float32Array(4);
        uniform[0] = low;
        uniform[1] = high;
        engine_ctx.queue.writeBuffer(this.constant, 0, uniform.buffer, uniform.byteOffset, uniform.byteLength);
    
        let colorAttachment =  {
            view:  this.dst_view, 
            loadOp: 'load',
            storeOp: 'store'
        };

        let renderPassDesc = {
            colorAttachments: [colorAttachment],            
        }; 

        let commandEncoder = engine_ctx.device.createCommandEncoder();

        let passEncoder = commandEncoder.beginRenderPass(renderPassDesc);
        passEncoder.setPipeline(this.pipeline);
        passEncoder.setBindGroup(0, this.bind_group);   
        passEncoder.setViewport(
            0,
            0,
            this.width,
            this.height,
            0,
            1
        );
        passEncoder.setScissorRect(
            0,
            0,
            this.width,
            this.height
        );

        passEncoder.draw(3, 1);    

        passEncoder.end();

        let cmdBuf = commandEncoder.finish();

        engine_ctx.queue.submit([cmdBuf]);

    }
}

async function load_base(url)
{
    return new Promise((resolve, reject) => {
        const info = document.getElementById("info");

        let decoder = new Decoder({rgb: false});

        let dims = [];
        let spacings = [];
        let low, high;
        let size_slice;
        let slice_loader;
        let tex_r16f;

        let count = 0;

        decoder.onPictureDecoded = (buffer, width, height, infos) =>{
            info.innerHTML = `Loading base image ${count}/${dims[2]}...`;

            let y = buffer.subarray(0, size_slice);
            engine_ctx.queue.writeTexture(
                { texture: slice_loader.src_tex},
                y,
                { bytesPerRow: dims[0]},
                { width: dims[0], height: dims[1]}
            );

            slice_loader.load_slice(low, high);

            {
                let commandEncoder = engine_ctx.device.createCommandEncoder();
                commandEncoder.copyTextureToTexture(
                    {
                        texture: slice_loader.dst_tex
                    },
                    {
                        texture: tex_r16f,
                        origin: {x: 0, y:0, z: count}
                    },
                    { width: dims[0], height: dims[1] }
                );
                let cmdBuf = commandEncoder.finish();
                engine_ctx.queue.submit([cmdBuf]);
            }
            
            count++;
            if (count == dims[2])
            {                
                info.innerHTML = `Done loading base image.`;
                resolve({
                    dims,
                    spacings,
                    low, high,
                    tex_r16f
                });
            }
        };

        let filesize;
        let file_offset = 0;
        let xhr;

        const load_packet = ()=>
        {
            const arrBuf = xhr.response;            
            let u8_view = new Uint8Array(arrBuf);                  
            file_offset += u8_view.length;
            decoder.decode(u8_view);
            
            if (file_offset<filesize)
            {
                xhr = new XMLHttpRequest(); 
                xhr.open("GET", url);
                xhr.responseType = "arraybuffer";
                xhr.setRequestHeader('Range', `bytes=${file_offset}-${file_offset+3 - 1}`);
                xhr.onload = load_packet_size;
                xhr.send();
            }
        };

        const load_packet_size = ()=>
        {
            const arrBuf = xhr.response;
            let data_view = new DataView(arrBuf);
            let offset = 0;

            let size_b0 = data_view.getUint8(offset, true); offset++;
            let size_b1 = data_view.getUint8(offset, true); offset++;
            let size_b2 = data_view.getUint8(offset, true); offset++;
            let isKey = (size_b2 & (1<<7)) !=0;
            size_b2 &= ~(1<<7);
            let size = (size_b2 << 16) + (size_b1<<8) + size_b0;

            file_offset+= offset;

            xhr = new XMLHttpRequest(); 
            xhr.open("GET", url);
            xhr.responseType = "arraybuffer";
            xhr.setRequestHeader('Range', `bytes=${file_offset}-${file_offset+size - 1}`);
            xhr.onload = load_packet;
            xhr.send();

        };

        const load_header = ()=>
        {
            const arrBuf = xhr.response;  
            let data_view = new DataView(arrBuf);
            let offset = 0;

            for (let i=0; i<3; i++)
            {
                let s = data_view.getInt32(offset, true);
                offset+=4;
                dims.push(s);
            }
            
            for (let i=0; i<3; i++)
            {
                let s = data_view.getFloat32(offset, true);
                offset+=4;
                spacings.push(s);
            }

            low = data_view.getFloat32(offset, true);
            offset+=4;

            high = data_view.getFloat32(offset, true);
            offset+=4;   

            file_offset+= offset;
                            
            size_slice = dims[0] * dims[1];
            slice_loader = new LoadSlice(dims[0], dims[1]);

            tex_r16f =  engine_ctx.device.createTexture({
                size: { width: dims[0], height: dims[1], depthOrArrayLayers:  dims[2] },
                dimension: "3d",
                format: 'r16float',
                usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
            });

            if (file_offset<filesize)
            {
                xhr = new XMLHttpRequest(); 
                xhr.open("GET", url);
                xhr.responseType = "arraybuffer";
                xhr.setRequestHeader('Range', `bytes=${file_offset}-${file_offset+3-1}`);
                xhr.onload = load_packet_size;
                xhr.send();
            }
        };

        xhr = new XMLHttpRequest(); 
        xhr.open("HEAD", url); 
        xhr.onreadystatechange = ()=>
        {
            if (xhr.readyState == xhr.DONE) 
            {
                filesize=parseInt(xhr.getResponseHeader("Content-Length"));
                xhr = new XMLHttpRequest(); 
                xhr.open("GET", url);
                xhr.responseType = "arraybuffer";
                xhr.setRequestHeader('Range', `bytes=0-31`);
                xhr.onload = load_header;
                xhr.send();
            }
        };
        xhr.send();

    });

}

const shader_add_to_slice = `
struct Params
{
    range: vec2f,
    slice_coord: f32
};

@group(0) @binding(0)
var<uniform> uParams: Params;

@group(0) @binding(1) 
var uSampler: sampler;

@group(0) @binding(2)
var uTexSlice: texture_2d<f32>;

@group(0) @binding(3)
var uTexVol: texture_3d<f32>;

struct VSOut 
{
    @builtin(position) Position: vec4f,
    @location(0) vUV: vec2f
};

@vertex
fn vs_main(@builtin(vertex_index) vertId: u32) -> VSOut 
{
    var vsOut: VSOut;
    let grid = vec2(f32((vertId<<1)&2), f32(vertId & 2));
    let pos_proj = grid * vec2(2.0, 2.0) + vec2(-1.0, -1.0);    
    vsOut.vUV = vec2(grid.x, 1.0 -grid.y);
    vsOut.Position = vec4(pos_proj, 0.0, 1.0);
    return vsOut;
}

@fragment
fn fs_main(@location(0) vUV: vec2f) -> @location(0) vec4f
{
    let v_in_slice = textureSampleLevel(uTexSlice, uSampler, vUV, 0.0).x;
    let v_in_volume = textureSampleLevel(uTexVol, uSampler, vec3(vUV, uParams.slice_coord), 0.0).x;
    let v_out = v_in_volume + v_in_slice*(uParams.range.y-uParams.range.x) + uParams.range.x;
    return vec4(v_out);
}
`;

class AddToSlice
{
    constructor(volume)
    {
        this.width = volume.dims[0];
        this.height = volume.dims[1];
        this.slices = volume.dims[2];
        this.src_tex_vol = volume.tex_r16f;

        this.src_tex_slice = engine_ctx.device.createTexture({
            size: { width: this.width, height: this.height},
            dimension: "2d",
            format: 'r8unorm',
            usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
        });

        this.dst_tex = engine_ctx.device.createTexture({
            size: { width: this.width, height: this.height},
            dimension: "2d",
            format: 'r16float',
            usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC
        });

        this.src_view_vol = this.src_tex_vol.createView();
        this.src_view_slice = this.src_tex_slice.createView();
        this.dst_view =  this.dst_tex.createView();
        this.constant = engine_ctx.createBuffer0(16, GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST);
        this.sampler = engine_ctx.device.createSampler({});

        if (!("add_to_slice" in engine_ctx.cache.bindGroupLayouts))
        {
            engine_ctx.cache.bindGroupLayouts.add_to_slice = engine_ctx.device.createBindGroupLayout({
                entries: [
                    {
                        binding: 0,
                        visibility: GPUShaderStage.FRAGMENT,
                        buffer:{
                            type: "uniform"
                        }
                    },
                    {
                        binding: 1,
                        visibility: GPUShaderStage.FRAGMENT,
                        sampler:{}
                    },
                    {
                        binding: 2,
                        visibility: GPUShaderStage.FRAGMENT,
                        texture:{
                            viewDimension: "2d"
                        }
                    },
                    {
                        binding: 3,
                        visibility: GPUShaderStage.FRAGMENT,
                        texture:{
                            viewDimension: "3d"
                        }
                    }
                ]
            });
        }

        const bindGroupLayout = engine_ctx.cache.bindGroupLayouts.add_to_slice;
        this.bind_group = engine_ctx.device.createBindGroup({
            layout: bindGroupLayout,
            entries: [
                {
                    binding: 0,
                    resource:{
                        buffer: this.constant
                    }
                },
                {
                    binding: 1,
                    resource: this.sampler
                },
                {
                    binding: 2,
                    resource: this.src_view_slice 
                },
                {
                    binding: 3,
                    resource: this.src_view_vol 
                }
            ]
        });

        const pipelineLayoutDesc = { bindGroupLayouts: [engine_ctx.cache.bindGroupLayouts.add_to_slice] };
        this.layout = engine_ctx.device.createPipelineLayout(pipelineLayoutDesc);
        this.shaderModule = engine_ctx.device.createShaderModule({code: shader_add_to_slice});

        const vertex = {
            module: this.shaderModule,
            entryPoint: 'vs_main',
            buffers: []
        };

        const colorState = {
            format: 'r16float',
            writeMask: GPUColorWrite.ALL
        };

        const fragment = {
            module: this.shaderModule,
            entryPoint: 'fs_main',
            targets: [colorState]
        };

        const primitive = {
            frontFace: 'cw',
            cullMode: 'none',
            topology: 'triangle-list'
        };

        const pipelineDesc = {
            layout: this.layout,
    
            vertex,
            fragment,
    
            primitive,
        };

        this.pipeline = engine_ctx.device.createRenderPipeline(pipelineDesc);

    }

    load_slice(low, high, slice)
    {
        const uniform = new Float32Array(4);
        uniform[0] = low;
        uniform[1] = high;
        uniform[2] = (slice + 0.5)/this.slices;
        engine_ctx.queue.writeBuffer(this.constant, 0, uniform.buffer, uniform.byteOffset, uniform.byteLength);

        let colorAttachment =  {
            view:  this.dst_view, 
            loadOp: 'load',
            storeOp: 'store'
        };

        let renderPassDesc = {
            colorAttachments: [colorAttachment],            
        }; 

        let commandEncoder = engine_ctx.device.createCommandEncoder();

        let passEncoder = commandEncoder.beginRenderPass(renderPassDesc);
        passEncoder.setPipeline(this.pipeline);
        passEncoder.setBindGroup(0, this.bind_group);   
        passEncoder.setViewport(
            0,
            0,
            this.width,
            this.height,
            0,
            1
        );
        passEncoder.setScissorRect(
            0,
            0,
            this.width,
            this.height
        );

        passEncoder.draw(3, 1);    

        passEncoder.end();

        let cmdBuf = commandEncoder.finish();

        engine_ctx.queue.submit([cmdBuf]);
    }
}

function load_residual(volume, url)
{
    const info = document.getElementById("info");
    const slice_adder = new AddToSlice(volume);
    const num_slice = volume.dims[2];    
    
    let filesize;
    let file_offset = 0;
    let xhr;

    let low, high;

    let urlCreator = window.URL || window.webkitURL;
    let img = document.createElement("img");    

    let count = 0;

    const load_slice = async () =>
    {
        const blob = xhr.response;
        file_offset += blob.size;

        info.innerHTML = `Loading residual image ${count}/${num_slice}...`;

        var imageUrl = urlCreator.createObjectURL(blob);
        img.src = imageUrl;
        await img.decode();
        const imageBitmap = await createImageBitmap(img);

        engine_ctx.queue.copyExternalImageToTexture(
            { source: imageBitmap},
            { texture: slice_adder.src_tex_slice},
            [volume.dims[0], volume.dims[1]]
        );        

        slice_adder.load_slice(low, high, count);

        {
            let commandEncoder = engine_ctx.device.createCommandEncoder();
            commandEncoder.copyTextureToTexture(
                {
                    texture: slice_adder.dst_tex
                },
                {
                    texture: volume.tex_r16f,
                    origin: {x: 0, y:0, z: count}
                },
                { width: volume.dims[0], height: volume.dims[1] }
            );
            let cmdBuf = commandEncoder.finish();
            engine_ctx.queue.submit([cmdBuf]);
        }

        count++;
        if (count == num_slice)
        {
            info.innerHTML = `Done loading residual image.`;
        }

        if (file_offset<filesize)
        {
            xhr = new XMLHttpRequest(); 
            xhr.open("GET", url);
            xhr.responseType = "arraybuffer";
            xhr.setRequestHeader('Range', `bytes=${file_offset}-${file_offset+ 12 - 1}`);
            xhr.onload = load_slice_header;
            xhr.send();
        }        
    };

    const load_slice_header = ()=>
    {
        const arrBuf = xhr.response;  
        let data_view = new DataView(arrBuf);
        let offset = 0;

        low = data_view.getFloat32(offset, true);
        offset+=4;

        high = data_view.getFloat32(offset, true);
        offset+=4;  

        let size = data_view.getInt32(offset, true);
        offset+=4;        

        file_offset+= offset;

        xhr = new XMLHttpRequest(); 
        xhr.open("GET", url);
        xhr.responseType = "blob";
        xhr.setRequestHeader('Range', `bytes=${file_offset}-${file_offset+size - 1}`);
        xhr.onload = load_slice;
        xhr.send();

    };

    xhr = new XMLHttpRequest(); 
    xhr.open("HEAD", url); 
    xhr.onreadystatechange = ()=>
    {
        if (xhr.readyState == xhr.DONE) 
        {
            filesize=parseInt(xhr.getResponseHeader("Content-Length"));
            if (file_offset<filesize)
            {
                xhr = new XMLHttpRequest(); 
                xhr.open("GET", url);
                xhr.responseType = "arraybuffer";
                xhr.setRequestHeader('Range', `bytes=0-11`);
                xhr.onload = load_slice_header;
                xhr.send();
            }

        }


    };
    xhr.send();
}


const shader_viewer =`
struct Viewer
{    
    size: vec4i,
    spacing: vec4f,
    window: vec2f,
    cur_slice: i32,
    show_label: i32
};

@group(0) @binding(0)
var<uniform> uViewer: Viewer;

@group(0) @binding(1) 
var uSampler: sampler;

@group(0) @binding(2)
var uTex: texture_3d<f32>;

@group(0) @binding(3)
var uTexColors: texture_1d<f32>;

@group(0) @binding(4)
var uTexLabel: texture_3d<u32>;

struct VSOut 
{
    @builtin(position) Position: vec4f,
    @location(0) vUV: vec2f
};

@vertex
fn vs_main(@builtin(vertex_index) vertId: u32) -> VSOut 
{
    var vsOut: VSOut;
    let grid = vec2(f32((vertId<<1)&2), f32(vertId & 2));
    let pos_proj = grid * vec2(2.0, 2.0) + vec2(-1.0, -1.0);    
    vsOut.vUV = grid;
    vsOut.Position = vec4(pos_proj, 0.0, 1.0);
    return vsOut;
}

@fragment
fn fs_axial_main(@location(0) vUV: vec2f) -> @location(0) vec4f
{
    let coord3d = vec3(vUV, (f32(uViewer.cur_slice) + 0.5)/f32(uViewer.size.z));    
    let v = textureSampleLevel(uTex, uSampler, coord3d, 0.0).x;
    let n = clamp((v - uViewer.window.y)/ uViewer.window.x + 0.5, 0.0, 1.0);    
    var col = vec3(n);
    /*if (uViewer.show_label>0)
    {
        let ucoord3d = vec3u(coord3d * vec3f(uViewer.size.xyz) + 0.5);
        let l = textureLoad(uTexLabel, ucoord3d, 0).x;    
        if (l>0)
        {
            let c = textureLoad(uTexColors, (l-1)%15, 0).xyz;
            col = n*0.5 + c *0.5;
        }
    }*/
    return vec4(col, 1.0);
}

@fragment
fn fs_coronal_main(@location(0) vUV: vec2f) -> @location(0) vec4f
{
    let coord3d = vec3(vUV.x, (f32(uViewer.cur_slice) + 0.5)/f32(uViewer.size.y), vUV.y);    
    let v = textureSampleLevel(uTex, uSampler, coord3d, 0.0).x;
    let n = clamp((v - uViewer.window.y)/ uViewer.window.x + 0.5, 0.0, 1.0);
    var col = vec3(n);
    /*if (uViewer.show_label>0)
    {
        let ucoord3d = vec3u(coord3d * vec3f(uViewer.size.xyz) + 0.5);
        let l = textureLoad(uTexLabel, ucoord3d, 0).x;    
        if (l>0)
        {
            let c = textureLoad(uTexColors, (l-1)%15, 0).xyz;
            col = n*0.5 + c *0.5;
        }
    }*/
    return vec4(col, 1.0);
}

@fragment
fn fs_sagittal_main(@location(0) vUV: vec2f) -> @location(0) vec4f
{
    let coord3d = vec3((f32(uViewer.cur_slice) + 0.5)/f32(uViewer.size.x), vUV.xy);    
    let v = textureSampleLevel(uTex, uSampler, coord3d, 0.0).x;
    let n = clamp((v - uViewer.window.y)/ uViewer.window.x + 0.5, 0.0, 1.0);
    var col = vec3(n);
    /*if (uViewer.show_label>0)
    {
        let ucoord3d = vec3u(coord3d * vec3f(uViewer.size.xyz) + 0.5);
        let l = textureLoad(uTexLabel, ucoord3d, 0).x;    
        if (l>0)
        {
            let c = textureLoad(uTexColors, (l-1)%15, 0).xyz;
            col = n*0.5 + c *0.5;
        }
    }*/
    return vec4(col, 1.0);
}
`;

class SliceViewer
{
    constructor(volume, label, tex_colors, mode = "axial")
    {
        this.volume = volume;
        this.label = label;
        this.tex_colors = tex_colors;
        this.mode = mode;
        this.show_label = true;
    }

    async initialize()
    {        
        const size = [
            this.volume.dims[0]*this.volume.spacings[0],
            this.volume.dims[1]*this.volume.spacings[1],
            this.volume.dims[2]*this.volume.spacings[2]
        ];

        this.num_slices = 0;
        if (this.mode == "axial")
        {
            this.num_slices = this.volume.dims[2];
        }
        else if (this.mode == "coronal")
        {
            this.num_slices = this.volume.dims[1];
        }
        else if (this.mode == "sagittal")
        {
            this.num_slices = this.volume.dims[0];
        }

        const container = document.getElementById(this.mode);
        this.canvas = document.createElement("canvas");
        if (this.mode == "axial")
        {
            this.canvas.width = this.volume.dims[0];
            this.canvas.height = this.volume.dims[1];
            this.canvas.style.cssText = `height: 512px; width: ${512/size[1]*size[0]}px`;
        }
        else if (this.mode == "coronal")
        {
            this.canvas.width = this.volume.dims[0];
            this.canvas.height = this.volume.dims[2];
            this.canvas.style.cssText = `height: 512px; width: ${512/size[2]*size[0]}px`;
        }
        else if (this.mode == "sagittal")
        {
            this.canvas.width = this.volume.dims[1];
            this.canvas.height = this.volume.dims[2];
            this.canvas.style.cssText = `height: 512px; width: ${512/size[2]*size[1]}px`;
        }
        container.appendChild(this.canvas);
        this.canvas_ctx = new CanvasContext(this.canvas);
        await this.canvas_ctx.initialize();

        this.window_width = 4096.0;
        this.window_center = 2048.0;
        this.cur_slice = Math.floor(this.num_slices/2);

        {
            const line = document.createElement("p");
            line.innerHTML = "Slice: "

            const input_slice = document.createElement("input");
            input_slice.type="range";
            input_slice.style="width:250px;";
            input_slice.min = "0";
            input_slice.max = `${this.num_slices-1}`;
            input_slice.value = `${this.num_slices/2}`;
            input_slice.addEventListener("input", () => {
                this.cur_slice = parseInt(input_slice.value);
                this.updateConstant();
            });
            line.appendChild(input_slice);

            container.appendChild(line);
        }

        {
            const line = document.createElement("p");
            line.innerHTML = "Window width: "

            const input_win_width = document.createElement("input");
            input_win_width.type="range";
            input_win_width.style="width:250px;";
            input_win_width.min = "1";
            input_win_width.max = "4096";
            input_win_width.value = "4096";
            input_win_width.addEventListener("input", () => {
                this.window_width = parseInt(input_win_width.value);
                this.updateConstant();
            });
            line.appendChild(input_win_width);

            container.appendChild(line);
        }

        {
            const line = document.createElement("p");
            line.innerHTML = "Window center: "

            const input_win_center= document.createElement("input");
            input_win_center.type="range";
            input_win_center.style="width:250px;";
            input_win_center.min = "0";
            input_win_center.max = "4096";
            input_win_center.value = "2048";
            input_win_center.addEventListener("input", () => {
                this.window_center = parseInt(input_win_center.value);
                this.updateConstant();
            });
            line.appendChild(input_win_center);

            container.appendChild(line);
        }

        /*{
            const line = document.createElement("p");
            line.innerHTML = "Show label: "

            const input_show_label= document.createElement("input");
            input_show_label.type="checkbox";
            input_show_label.checked = "true";
            input_show_label.addEventListener('change', () => {
                this.show_label = input_show_label.checked;
                this.updateConstant();
            });
            line.appendChild(input_show_label);

            container.appendChild(line);
        }*/

        const const_size = (4*2 + 2 + 2)*4;
        this.constant = engine_ctx.createBuffer0(const_size, GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST);
        this.sampler = engine_ctx.device.createSampler({ magFilter: "linear", minFilter:"linear"});

        if (!("slice_viewer" in engine_ctx.cache.bindGroupLayouts))
        {
            engine_ctx.cache.bindGroupLayouts.slice_viewer = engine_ctx.device.createBindGroupLayout({
                entries: [
                    {
                        binding: 0,
                        visibility: GPUShaderStage.FRAGMENT,
                        buffer:{
                            type: "uniform"
                        }
                    },
                    {
                        binding: 1,
                        visibility: GPUShaderStage.FRAGMENT,
                        sampler:{}
                    },
                    {
                        binding: 2,
                        visibility: GPUShaderStage.FRAGMENT,
                        texture:{
                            viewDimension: "3d"
                        }
                    },
                    {
                        binding: 3,
                        visibility: GPUShaderStage.FRAGMENT,
                        texture:{
                            viewDimension: "1d"
                        }
                    },
                    /*{
                        binding: 4,
                        visibility: GPUShaderStage.FRAGMENT,
                        texture:{
                            viewDimension: "3d",
                            sampleType : "uint"
                        }
                    },*/
                ]
            });
        }

        const bindGroupLayout = engine_ctx.cache.bindGroupLayouts.slice_viewer;
        this.bind_group = engine_ctx.device.createBindGroup({
            layout: bindGroupLayout,
            entries: [
                {
                    binding: 0,
                    resource:{
                        buffer: this.constant
                    }
                },
                {
                    binding: 1,
                    resource: this.sampler
                },
                {
                    binding: 2,
                    resource: this.volume.tex_r16f.createView()
                },
                {
                    binding: 3,
                    resource: this.tex_colors.createView()
                },
                /*{
                    binding: 4,
                    resource: this.label.createView()
                }*/
            ]
        });

        this.updateConstant();
        const pipelineLayoutDesc = { bindGroupLayouts: [engine_ctx.cache.bindGroupLayouts.slice_viewer] };
        this.layout = engine_ctx.device.createPipelineLayout(pipelineLayoutDesc);
        this.shaderModule = engine_ctx.device.createShaderModule({code: shader_viewer});

        const vertex = {
            module: this.shaderModule,
            entryPoint: 'vs_main',
            buffers: []
        };

        const colorState = {
            format: this.canvas_ctx.view_format,
            writeMask: GPUColorWrite.ALL
        };

        const fragment = {
            module: this.shaderModule,
            entryPoint: `fs_${this.mode}_main`,
            targets: [colorState]
        };

        const primitive = {
            frontFace: 'cw',
            cullMode: 'none',
            topology: 'triangle-list'
        };

        const pipelineDesc = {
            layout: this.layout,
    
            vertex,
            fragment,
    
            primitive,
        };

        this.pipeline = engine_ctx.device.createRenderPipeline(pipelineDesc);
        this.render();
    }

    updateConstant()
    {
        const uniform = new Float32Array(4*2 + 2 + 2);
        const iuniform = new Int32Array(uniform.buffer);
        for (let i=0; i<3; i++)
        {
            iuniform[i] = this.volume.dims[i];
        }
        for (let i=0; i<3; i++)
        {
            uniform[4+i] = this.volume.spacings[i];
        }
        uniform[8] = this.window_width;
        uniform[9] = this.window_center;
        iuniform[10] = this.cur_slice;
        iuniform[11] = this.show_label?1:0;
        engine_ctx.queue.writeBuffer(this.constant, 0, uniform.buffer, uniform.byteOffset, uniform.byteLength);
    }

    render()
    {        
        let colorTexture = this.canvas_ctx.context.getCurrentTexture();
        let colorTextureView = colorTexture.createView({ format: this.canvas_ctx.view_format});

        let colorAttachment =  {
            view: colorTextureView,
            clearValue: { r: 0.6, g: 0.6, b: 0.8, a: 1 },
            loadOp: 'clear',
            storeOp: 'store'
        };

        let renderPassDesc = {
            colorAttachments: [colorAttachment],            
        }; 

        let commandEncoder = engine_ctx.device.createCommandEncoder();

        let canvas = this.canvas_ctx.canvas;

        let passEncoder = commandEncoder.beginRenderPass(renderPassDesc);
        passEncoder.setPipeline(this.pipeline);
        passEncoder.setBindGroup(0, this.bind_group);        
        passEncoder.setViewport(
            0,
            0,
            canvas.width,
            canvas.height,
            0,
            1
        );
        passEncoder.setScissorRect(
            0,
            0,
            canvas.width,
            canvas.height
        );

        passEncoder.draw(3, 1);    
        
        passEncoder.end();

        let cmdBuf = commandEncoder.finish();

        engine_ctx.queue.submit([cmdBuf]);

        requestAnimationFrame(()=>{this.render();});
    }

}

async function load_label(url, volume)
{
    const info = document.getElementById("info");
    info.innerHTML = `Loading label...`;
    let res = await fetch(url);
    let decompressedStream = await res.body.pipeThrough(new DecompressionStream("gzip"));
    let blob = await new Response(decompressedStream).blob();
    let label_data = await blob.arrayBuffer();    

    let dims = volume.dims;

    let tex_label = engine_ctx.device.createTexture({
        size: { width: dims[0], height: dims[1], depthOrArrayLayers:  dims[2] },
        dimension: "3d",
        format: 'r8uint',
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    });

    engine_ctx.queue.writeTexture(
        { texture:tex_label },
        label_data,
        { bytesPerRow: dims[0], rowsPerImage:  dims[1] },
        { width: dims[0], height: dims[1], depthOrArrayLayers: dims[2] },
    );

    info.innerHTML = `Done loading label...`;
    return tex_label;
}

function create_palatte()
{
    let palatte = Uint32Array.from([0xFF418CF0,0xFFFCB441,0xFFDF3A02,0xFF056492,0xFFBFBFBF,0xFF1A3B69,0xFFFFE382,0xFF129CDD,0xFFCA6B4B,0xFF005CDB,0xFFF3D288,0xFF506381,0xFFF1B9A8,0xFFE0830A,0xFF7893BE]);       
    let tex_colors = engine_ctx.device.createTexture({
        size: { width: 15 },
        dimension: "1d",
        format: 'bgra8unorm-srgb',
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    });

    engine_ctx.queue.writeTexture(
        { texture: tex_colors },
        palatte,
        { },
        { width: 15 },
    );

    return tex_colors;
}


export async function test()
{
    const engine_ctx = new EngineContext();
    await engine_ctx.initialize();
    let vol = await load_base("image_base");
    //let label = await load_label("label.raw.gz", vol);
    let label = null;
    let tex_colors = create_palatte();
    let axial_viewer = new SliceViewer(vol, label, tex_colors, "axial");
    axial_viewer.initialize();
    let coronal_viewer = new SliceViewer(vol, label, tex_colors, "coronal");
    coronal_viewer.initialize();
    let sagittal_viewer = new SliceViewer(vol, label, tex_colors, "sagittal");
    sagittal_viewer.initialize();    
    load_residual(vol, "image_residual");
    
}
