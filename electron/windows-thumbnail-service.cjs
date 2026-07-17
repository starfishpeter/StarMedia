const fs = require('node:fs/promises')
const path = require('node:path')
const { execFile } = require('node:child_process')
const { pathToFileURL } = require('node:url')

const thumbnailScript = `
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

public static class StarMediaThumbnail {
  [StructLayout(LayoutKind.Sequential)]
  private struct SIZE { public int cx; public int cy; }

  [Flags]
  private enum SIIGBF : uint { THUMBNAILONLY = 0x8, RESIZETOFIT = 0x0 }

  [ComImport]
  [Guid("bcc18b79-ba16-442f-80c4-8a59c30c463b")]
  [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  private interface IShellItemImageFactory {
    void GetImage(SIZE size, SIIGBF flags, out IntPtr phbm);
  }

  [DllImport("shell32.dll", CharSet = CharSet.Unicode, PreserveSig = false)]
  private static extern void SHCreateItemFromParsingName(string path, IntPtr bindContext, ref Guid riid, out IShellItemImageFactory shellItem);

  [DllImport("gdi32.dll")]
  [return: MarshalAs(UnmanagedType.Bool)]
  private static extern bool DeleteObject(IntPtr objectHandle);

  [StructLayout(LayoutKind.Sequential)]
  private struct GdiplusStartupInput {
    public uint GdiplusVersion;
    public IntPtr DebugEventCallback;
    [MarshalAs(UnmanagedType.Bool)] public bool SuppressBackgroundThread;
    [MarshalAs(UnmanagedType.Bool)] public bool SuppressExternalCodecs;
  }

  [DllImport("gdiplus.dll")]
  private static extern int GdiplusStartup(out ulong token, ref GdiplusStartupInput input, out IntPtr output);

  [DllImport("gdiplus.dll")]
  private static extern void GdiplusShutdown(ulong token);

  [DllImport("gdiplus.dll")]
  private static extern int GdipCreateBitmapFromHBITMAP(IntPtr bitmap, IntPtr palette, out IntPtr image);

  [DllImport("gdiplus.dll", CharSet = CharSet.Unicode)]
  private static extern int GdipSaveImageToFile(IntPtr image, string fileName, ref Guid classId, IntPtr encoderParameters);

  [DllImport("gdiplus.dll")]
  private static extern int GdipDisposeImage(IntPtr image);

  public static void Save(string sourcePath, string outputPath) {
    Guid iid = typeof(IShellItemImageFactory).GUID;
    IShellItemImageFactory shellItem;
    SHCreateItemFromParsingName(sourcePath, IntPtr.Zero, ref iid, out shellItem);
    IntPtr bitmapHandle = IntPtr.Zero;
    IntPtr image = IntPtr.Zero;
    ulong gdiplusToken = 0;
    try {
      shellItem.GetImage(new SIZE { cx = 640, cy = 360 }, SIIGBF.THUMBNAILONLY | SIIGBF.RESIZETOFIT, out bitmapHandle);
      if (bitmapHandle == IntPtr.Zero) throw new InvalidOperationException("Windows 未返回视频缩略图");
      var startup = new GdiplusStartupInput { GdiplusVersion = 1 };
      IntPtr startupOutput;
      if (GdiplusStartup(out gdiplusToken, ref startup, out startupOutput) != 0) throw new InvalidOperationException("无法启动图像编码器");
      if (GdipCreateBitmapFromHBITMAP(bitmapHandle, IntPtr.Zero, out image) != 0) throw new InvalidOperationException("无法读取视频缩略图");
      Guid jpegEncoder = new Guid("557cf401-1a04-11d3-9a73-0000f81ef32e");
      if (GdipSaveImageToFile(image, outputPath, ref jpegEncoder, IntPtr.Zero) != 0) throw new InvalidOperationException("无法保存视频缩略图");
    } finally {
      if (image != IntPtr.Zero) GdipDisposeImage(image);
      if (gdiplusToken != 0) GdiplusShutdown(gdiplusToken);
      if (bitmapHandle != IntPtr.Zero) DeleteObject(bitmapHandle);
    }
  }
}
'@

[StarMediaThumbnail]::Save(
  [Environment]::GetEnvironmentVariable('STARMEDIA_THUMB_SOURCE'),
  [Environment]::GetEnvironmentVariable('STARMEDIA_THUMB_OUTPUT')
)
`

function runPowerShell(command, environment) {
  return new Promise((resolve, reject) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(command, 'utf16le').toString('base64')],
      {
        windowsHide: true,
        timeout: 30000,
        maxBuffer: 1024 * 1024,
        env: environment,
      },
      (error, stdout, stderr) => {
        if (error) reject(new Error(stderr || stdout || error.message))
        else resolve()
      },
    )
  })
}

async function createElectronVideoThumbnail(sourcePath, outputPath) {
  const { app, BrowserWindow } = require('electron')
  if (!app.isReady()) await app.whenReady()
  const sourceUrl = pathToFileURL(path.resolve(sourcePath)).toString()
  const html = `<!doctype html><html><body style="margin:0;background:#000;overflow:hidden"><video id="video" preload="auto" muted playsinline src="${sourceUrl.replaceAll('"', '&quot;')}"></video><canvas id="canvas" width="640" height="360"></canvas><script>
    const video = document.getElementById('video')
    const canvas = document.getElementById('canvas')
    const context = canvas.getContext('2d', { alpha: false })
    window.__capture = new Promise((resolve, reject) => {
      const fail = () => reject(new Error('Chromium 无法解码视频'))
      video.addEventListener('error', fail, { once: true })
      video.addEventListener('loadedmetadata', () => {
        const ratio = video.videoWidth && video.videoHeight ? video.videoWidth / video.videoHeight : 16 / 9
        canvas.width = 640
        canvas.height = Math.max(1, Math.round(canvas.width / ratio))
        const seekTo = Number.isFinite(video.duration) && video.duration > 0 ? Math.min(video.duration * .1, Math.max(0, video.duration - .05)) : 0
        const draw = () => { context.drawImage(video, 0, 0, canvas.width, canvas.height); resolve(canvas.toDataURL('image/jpeg', .82)) }
        video.addEventListener('seeked', draw, { once: true })
        video.currentTime = seekTo
        if (seekTo === 0) video.addEventListener('loadeddata', draw, { once: true })
      }, { once: true })
      video.load()
    })
  </script></body></html>`
  const window = new BrowserWindow({
    show: false,
    width: 640,
    height: 360,
    useContentSize: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: false },
  })
  try {
    await window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
    const dataUrl = await Promise.race([
      window.webContents.executeJavaScript('window.__capture'),
      new Promise((_, reject) => setTimeout(() => reject(new Error('视频缩略图解码超时')), 30000)),
    ])
    const match = /^data:image\/jpeg;base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl))
    if (!match) throw new Error('视频缩略图编码无效')
    const buffer = Buffer.from(match[1], 'base64')
    if (buffer.length === 0) throw new Error('视频缩略图为空')
    await fs.writeFile(outputPath, buffer)
  } finally {
    if (!window.isDestroyed()) window.destroy()
  }
}

function createWindowsThumbnailService({
  platform = process.platform,
  fileSystem = fs,
  runShellThumbnail = runPowerShell,
  createFallbackThumbnail = createElectronVideoThumbnail,
  now = () => Date.now(),
  processId = process.pid,
} = {}) {
  if (typeof runShellThumbnail !== 'function' || typeof createFallbackThumbnail !== 'function') throw new Error('视频缩略图服务依赖不可用')

  async function createVideoThumbnail(sourcePath, outputPath) {
    if (platform !== 'win32') throw new Error('当前系统不支持视频缩略图生成')
    await fileSystem.mkdir(path.dirname(outputPath), { recursive: true })
    const temporaryPath = `${outputPath}.${processId}.${now()}.tmp`
    try {
      try {
        await runShellThumbnail(thumbnailScript, {
          ...process.env,
          STARMEDIA_THUMB_SOURCE: sourcePath,
          STARMEDIA_THUMB_OUTPUT: temporaryPath,
        })
        const stat = await fileSystem.stat(temporaryPath)
        if (!stat.isFile() || stat.size === 0) throw new Error('视频缩略图为空')
      } catch {
        await fileSystem.unlink(temporaryPath).catch(() => {})
        await createFallbackThumbnail(sourcePath, temporaryPath)
        const stat = await fileSystem.stat(temporaryPath)
        if (!stat.isFile() || stat.size === 0) throw new Error('视频缩略图为空')
      }
      await fileSystem.rename(temporaryPath, outputPath)
      return outputPath
    } catch (error) {
      await fileSystem.unlink(temporaryPath).catch(() => {})
      throw error
    }
  }

  return { createVideoThumbnail }
}

async function createWindowsVideoThumbnail(sourcePath, outputPath) {
  return createWindowsThumbnailService().createVideoThumbnail(sourcePath, outputPath)
}

module.exports = { createWindowsThumbnailService, createWindowsVideoThumbnail }
