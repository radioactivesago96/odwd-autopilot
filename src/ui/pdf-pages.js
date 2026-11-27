// Turns a PDF file into pages of positioned text for the report reader.
(() => {
  window.readPdfPages = async (buffer) => {
    const pdfjs = window.pdfjsLib;
    pdfjs.GlobalWorkerOptions.workerSrc = '../../node_modules/pdfjs-dist/build/pdf.worker.min.js';
    const doc = await pdfjs.getDocument({ data: new Uint8Array(buffer), isEvalSupported: false }).promise;
    const pages = [];
    for (let number = 1; number <= doc.numPages; number++) {
      const content = await (await doc.getPage(number)).getTextContent();
      pages.push({ items: content.items.map((it) => ({ str: it.str, x: it.transform[4], y: it.transform[5], width: it.width })) });
    }
    await doc.destroy();
    return pages;
  };
})();
