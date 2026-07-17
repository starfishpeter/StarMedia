const { pathToFileURL } = require('node:url')

const targetWidth = 360
const targetHeight = 500

function createNativeBookCoverThumbnail(sourcePath, nativeImage) {
  if (!nativeImage?.createFromPath) throw new Error('Electron 原生图片解码器不可用')
  const source = nativeImage.createFromPath(sourcePath)
  if (source.isEmpty()) throw new Error('Electron 原生图片解码器无法识别本子封面')
  const size = source.getSize()
  if (size.width <= 0 || size.height <= 0) throw new Error('本子封面尺寸无效')
  const scale = Math.max(targetWidth / size.width, targetHeight / size.height)
  const resized = source.resize({
    width: Math.max(targetWidth, Math.ceil(size.width * scale)),
    height: Math.max(targetHeight, Math.ceil(size.height * scale)),
    quality: 'good',
  })
  const resizedSize = resized.getSize()
  const thumbnail = resized.crop({
    x: Math.max(0, Math.floor((resizedSize.width - targetWidth) / 2)),
    y: Math.max(0, Math.floor((resizedSize.height - targetHeight) / 2)),
    width: targetWidth,
    height: targetHeight,
  })
  const jpeg = thumbnail.toJPEG(82)
  if (!jpeg.length) throw new Error('生成的本子缩略图为空')
  return jpeg
}

async function createChromiumBookCoverThumbnail(sourcePath) {
  const { app, BrowserWindow } = require('electron')
  if (!app.isReady()) await app.whenReady()
  const sourceUrl = pathToFileURL(sourcePath).toString()
  const html = `<!doctype html><html><body><canvas id="canvas" width="${targetWidth}" height="${targetHeight}"></canvas><script>
    const image = new Image()
    const canvas = document.getElementById('canvas')
    const context = canvas.getContext('2d', { alpha: false })
    window.__capture = new Promise((resolve, reject) => {
      image.addEventListener('error', () => reject(new Error('Chromium 无法解码本子封面')), { once: true })
      image.addEventListener('load', () => {
        if (!image.naturalWidth || !image.naturalHeight) return reject(new Error('本子封面尺寸无效'))
        const scale = Math.max(canvas.width / image.naturalWidth, canvas.height / image.naturalHeight)
        const width = image.naturalWidth * scale
        const height = image.naturalHeight * scale
        context.fillStyle = '#18181b'
        context.fillRect(0, 0, canvas.width, canvas.height)
        context.drawImage(image, (canvas.width - width) / 2, (canvas.height - height) / 2, width, height)
        resolve(canvas.toDataURL('image/jpeg', .82))
      }, { once: true })
      image.src = ${JSON.stringify(sourceUrl)}
    })
  </script></body></html>`
  const window = new BrowserWindow({
    show: false,
    width: targetWidth,
    height: targetHeight,
    useContentSize: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: false },
  })
  try {
    await window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
    const dataUrl = await Promise.race([
      window.webContents.executeJavaScript('window.__capture'),
      new Promise((_, reject) => setTimeout(() => reject(new Error('本子封面解码超时')), 15000)),
    ])
    const match = /^data:image\/jpeg;base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl))
    if (!match) throw new Error('本子缩略图编码无效')
    const jpeg = Buffer.from(match[1], 'base64')
    if (!jpeg.length) throw new Error('生成的本子缩略图为空')
    return jpeg
  } finally {
    if (!window.isDestroyed()) window.destroy()
  }
}

function createBookCoverThumbnailService({ nativeImage, writeFileAtomically, createFallbackThumbnail = createChromiumBookCoverThumbnail }) {
  if (typeof writeFileAtomically !== 'function' || typeof createFallbackThumbnail !== 'function')
    throw new Error('本子缩略图服务依赖不可用')

  async function createBookCoverThumbnail(sourcePath, outputPath) {
    let jpeg
    try {
      jpeg = createNativeBookCoverThumbnail(sourcePath, nativeImage)
    } catch (nativeError) {
      try {
        jpeg = await createFallbackThumbnail(sourcePath)
      } catch (fallbackError) {
        throw new AggregateError([nativeError, fallbackError], `无法解码本子封面：${fallbackError.message}`, { cause: fallbackError })
      }
    }
    if (!Buffer.isBuffer(jpeg) || jpeg.length === 0) throw new Error('生成的本子缩略图为空')
    await writeFileAtomically(outputPath, jpeg)
  }

  return { createBookCoverThumbnail }
}

module.exports = {
  createBookCoverThumbnailService,
  createChromiumBookCoverThumbnail,
  createNativeBookCoverThumbnail,
}
