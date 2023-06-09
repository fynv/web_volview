export class CanvasContext
{
    constructor(canvas, has_depth = false)
    {        
        this.has_depth = has_depth;
        this.canvas = canvas;
        this.context = null;
        this.depthTexture = null;
        this.depthTextureView = null;
        this.resized = false;
        this.view_format = 'rgba8unorm-srgb';
    }

    async initialize()
    {
        if (this.context!=null) return;
        await engine_ctx.initialize();

        this.context = this.canvas.getContext('webgpu');
        const presentationFormat = navigator.gpu.getPreferredCanvasFormat();
        if (presentationFormat == "bgra8unorm")
        {
            this.view_format = 'bgra8unorm-srgb';
        }        
        const canvasConfig = {
            device: engine_ctx.device,
            alphaMode: "opaque",
            format: presentationFormat,
            viewFormats: [this.view_format],
            usage:  GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC
        };
        this.context.configure(canvasConfig);
        this.resize();
    }

    resize()
    {
        if (this.has_depth)
        {
            const depthTextureDesc = {
                size: [this.canvas.width, this.canvas.height, 1],
                dimension: '2d',
                format: 'depth32float',
                usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC
            };
            this.depthTexture = engine_ctx.device.createTexture(depthTextureDesc);
            this.depthTextureView = this.depthTexture.createView();
        }
        this.resized = true;
    }
}
