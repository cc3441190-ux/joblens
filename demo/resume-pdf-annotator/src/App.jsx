import PDFViewer from "./components/PDFViewer.jsx";

const DEFAULT_PDF =
  "https://mozilla.github.io/pdf.js/web/compressed.tracemonkey-pldi-09.pdf";

export default function App() {
  return <PDFViewer pdfUrl={DEFAULT_PDF} />;
}
