import { useEffect, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, LoaderCircle } from 'lucide-react'
import * as pdfjsLib from 'pdfjs-dist'
import { Button } from '@/components/ui/button'

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.mjs',
  import.meta.url,
).toString()

interface PdfViewerProps {
  url: string
  initialPage?: number
}

export function PdfViewer({ url, initialPage = 1 }: PdfViewerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const [pdf, setPdf] = useState<pdfjsLib.PDFDocumentProxy | null>(null)
  const [page, setPage] = useState(initialPage)
  const [totalPages, setTotalPages] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true) // eslint-disable-line react-hooks/set-state-in-effect
    setError(null) // eslint-disable-line react-hooks/set-state-in-effect

    pdfjsLib.getDocument(url).promise.then(
      (doc) => {
        if (cancelled) return
        setPdf(doc)
        setTotalPages(doc.numPages)
        setPage(Math.min(initialPage, doc.numPages))
        setLoading(false)
      },
      (err) => {
        if (cancelled) return
        setError(String(err?.message || 'Gagal memuat PDF'))
        setLoading(false)
      },
    )

    return () => {
      cancelled = true
    }
  }, [url, initialPage])

  useEffect(() => {
    if (!pdf || !canvasRef.current || !containerRef.current) return

    let cancelled = false

    pdf.getPage(page).then((pdfPage) => {
      if (cancelled || !canvasRef.current || !containerRef.current) return

      const containerWidth = containerRef.current.clientWidth
      const unscaledViewport = pdfPage.getViewport({ scale: 1 })
      const scale = containerWidth / unscaledViewport.width
      const viewport = pdfPage.getViewport({ scale })

      const canvas = canvasRef.current
      canvas.height = viewport.height
      canvas.width = viewport.width

      const ctx = canvas.getContext('2d')
      if (!ctx) return

      pdfPage.render({ canvasContext: ctx, viewport, canvas })
    })

    return () => {
      cancelled = true
    }
  }, [pdf, page])

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <LoaderCircle className="h-6 w-6 animate-spin text-primary" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-destructive">
        {error}
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-center gap-3 border-b py-2">
        <Button
          size="sm"
          variant="ghost"
          disabled={page <= 1}
          onClick={() => setPage((p) => Math.max(1, p - 1))}
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <span className="text-sm text-muted-foreground">
          Halaman {page} / {totalPages}
        </span>
        <Button
          size="sm"
          variant="ghost"
          disabled={page >= totalPages}
          onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
      <div ref={containerRef} className="flex-1 overflow-auto bg-muted/30 p-4">
        <canvas ref={canvasRef} className="mx-auto shadow-lg" />
      </div>
    </div>
  )
}
