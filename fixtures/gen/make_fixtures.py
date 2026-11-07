#!/usr/bin/env python3
"""Regenerate the LecScribe demo/test fixtures (macOS only: needs `say`, ffmpeg, Pillow).

Outputs (committed, so nobody else needs to run this):
  fixtures/deck.pdf              5 slides, 960x540pt. Slides 1,2,3,5 have real text; slide 4 is image-only (OCR test).
  fixtures/slides/slide-N.png    1280x720 page images (N = 1..5)
  fixtures/slides.json           Slide[] {index, text, image, imageOnly}  (text of slide 4 = OCR ground truth)
  fixtures/lecture.wav           16 kHz mono s16 narration following slides 1..5
  fixtures/lecture.script.json   segments with slideIndex, tStart, tEnd, text, notOnSlide facts
  fixtures/explain.wav           16 kHz mono "Explain slide" recording for slide index 3
Run:  python3 fixtures/gen/make_fixtures.py
"""
import json, os, subprocess, tempfile, wave, io
from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))  # fixtures/
VOICE = "Daniel"  # en_GB
RATE = 175        # words per minute
GAP = 1.2         # seconds of silence between slides
SR = 16000

MODULE = {"moduleId": "COMP26120", "moduleName": "Algorithms and Data Structures", "weekId": "week-3"}

SLIDES = [
    {"title": "Hash Tables", "bullets": ["COMP26120 - Week 3", "Hashing, collisions, load factor, resizing"]},
    {"title": "Hash functions", "bullets": ["Map a key to an array index", "h(k) = k mod m", "Spread keys uniformly across buckets"]},
    {"title": "Collisions", "bullets": ["Two keys can map to the same index", "Separate chaining: a list per bucket", "Open addressing: probe for a free slot"]},
    {"title": "Load factor", "bullets": ["α = n / m  (items / buckets)", "Keep α below 0.75", "Lookup is O(1) on average"], "imageOnly": True},
    {"title": "Resizing", "bullets": ["Double the array when the load factor is too high", "Rehash every key", "Insert is amortised O(1)"]},
]

NARRATION = [
    {"text": "Welcome back, everyone. This week we are looking at hash tables, which sit behind Python dictionaries and Java's HashMap. "
             "This will come up in the exam, so pay close attention to the load factor part.",
     "notOnSlide": ["Hash tables are what Python dictionaries and Java's HashMap use", "The load factor will come up in the exam"]},
    {"text": "Let's start with hash functions. A hash function turns a key into an index in the array, and the simplest one is k mod m. "
             "A good tip is to choose m to be a prime number. If m is a power of two, the modulus only looks at the lowest bits of the key, "
             "so similar keys pile up in the same buckets.",
     "notOnSlide": ["Choose the table size m to be prime", "If m is a power of two, only the lowest bits of the key are used, so similar keys cluster"]},
    {"text": "Now, collisions. Two different keys can land at the same index. With separate chaining, each bucket holds a linked list. "
             "With open addressing, we probe for the next free slot. Linear probing is cache friendly, but it suffers from primary clustering, "
             "where long runs of filled slots form and slow every lookup down.",
     "notOnSlide": ["Linear probing is cache friendly", "Linear probing suffers from primary clustering: long runs of filled slots slow lookups"]},
    {"text": "The load factor, alpha, is the number of items divided by the number of buckets. Java's HashMap resizes when alpha goes above zero point seven five. "
             "With open addressing, as alpha approaches one, the expected number of probes blows up, roughly one over one minus alpha.",
     "notOnSlide": ["Java's HashMap resizes when alpha exceeds 0.75", "With open addressing, expected probes grow like 1 / (1 - alpha)"]},
    {"text": "Finally, resizing. When the table gets too full, we allocate an array twice the size and reinsert every key, because each key's index depends on m. "
             "One resize costs order n, but spread over all the inserts it is amortised constant time. In Thursday's lab you will implement this yourselves.",
     "notOnSlide": ["Every key must be reinserted because its index depends on m", "One resize costs O(n)", "Thursday's lab implements resizing"]},
]

EXPLAIN = {"slideIndex": 3,
           "text": "Okay, quite a few of you are lost on the load factor, so let me put it another way. Think of the hash table as a car park. "
                   "Alpha is how full the car park is. When it is nearly full, you drive around for ages looking for a free space, "
                   "and that is exactly what probing feels like. So we build a bigger car park before it gets that full."}

W, H = 1280, 720
FONT_T = "/System/Library/Fonts/Supplemental/Arial Bold.ttf"
FONT_B = "/System/Library/Fonts/Supplemental/Arial.ttf"


def slide_text(s):
    return s["title"] + "\n" + "\n".join(s["bullets"])


def render_png(s, idx):
    img = Image.new("RGB", (W, H), "white")
    d = ImageDraw.Draw(img)
    d.rectangle([0, 0, W, 14], fill=(30, 64, 175))
    d.text((80, 70), s["title"], font=ImageFont.truetype(FONT_T, 64), fill=(17, 24, 39))
    fb = ImageFont.truetype(FONT_B, 40)
    for i, b in enumerate(s["bullets"]):
        y = 220 + i * 90
        d.ellipse([84, y + 14, 100, y + 30], fill=(30, 64, 175))
        d.text((125, y), b, font=fb, fill=(31, 41, 55))
    d.text((W - 120, H - 60), f"{idx + 1}/5", font=ImageFont.truetype(FONT_B, 24), fill=(107, 114, 128))
    return img


def pdf_escape(t):
    return t.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")


def build_pdf(images):
    """Hand-written PDF: text pages use Helvetica (extractable text); imageOnly pages embed a JPEG only."""
    PW, PH = 960, 540
    objs = []  # list of bytes, object number = index+1

    def add(b):
        objs.append(b if isinstance(b, bytes) else b.encode("latin-1"))
        return len(objs)

    font_b = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>")
    font_r = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>")
    pages_num = len(objs) + 1  # reserve
    add(b"")  # placeholder for Pages
    page_nums = []
    for i, s in enumerate(SLIDES):
        if s.get("imageOnly"):
            buf = io.BytesIO(); images[i].save(buf, "JPEG", quality=88); jpg = buf.getvalue()
            im = add(f"<< /Type /XObject /Subtype /Image /Width {W} /Height {H} /ColorSpace /DeviceRGB /BitsPerComponent 8 "
                     f"/Filter /DCTDecode /Length {len(jpg)} >>\nstream\n".encode("latin-1") + jpg + b"\nendstream")
            content = f"q {PW} 0 0 {PH} 0 0 cm /Im0 Do Q"
            res = f"<< /XObject << /Im0 {im} 0 R >> >>"
        else:
            ops = ["0.117 0.251 0.686 rg 0 %d %d 10 re f" % (PH - 10, PW)]
            ops.append("BT 0.067 0.094 0.153 rg /F1 44 Tf 60 %d Td (%s) Tj ET" % (PH - 100, pdf_escape(s["title"])))
            for j, b in enumerate(s["bullets"]):
                y = PH - 190 - j * 62
                ops.append("BT 0.122 0.161 0.216 rg /F2 28 Tf 90 %d Td (%s) Tj ET" % (y, pdf_escape("- " + b)))
            ops.append("BT 0.42 0.45 0.5 rg /F2 16 Tf %d 30 Td (%d/5) Tj ET" % (PW - 80, i + 1))
            content = "\n".join(ops)
            res = f"<< /Font << /F1 {font_b} 0 R /F2 {font_r} 0 R >> >>"
        c = add(f"<< /Length {len(content.encode('latin-1'))} >>\nstream\n{content}\nendstream")
        p = add(f"<< /Type /Page /Parent {pages_num} 0 R /MediaBox [0 0 {PW} {PH}] /Resources {res} /Contents {c} 0 R >>")
        page_nums.append(p)
    objs[pages_num - 1] = (f"<< /Type /Pages /Kids [{' '.join(f'{p} 0 R' for p in page_nums)}] /Count {len(page_nums)} >>").encode()
    info = add("<< /Title (Week 3: Hash Tables) /Author (LecScribe fixtures) >>")
    catalog = add(f"<< /Type /Catalog /Pages {pages_num} 0 R >>")

    out = bytearray(b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n")
    offsets = []
    for n, b in enumerate(objs, 1):
        offsets.append(len(out))
        out += f"{n} 0 obj\n".encode() + b + b"\nendobj\n"
    xref = len(out)
    out += f"xref\n0 {len(objs) + 1}\n0000000000 65535 f \n".encode()
    for o in offsets:
        out += f"{o:010d} 00000 n \n".encode()
    out += f"trailer\n<< /Size {len(objs) + 1} /Root {catalog} 0 R /Info {info} 0 R >>\nstartxref\n{xref}\n%%EOF\n".encode()
    return bytes(out)


def tts_to_wav(text, path):
    with tempfile.TemporaryDirectory() as td:
        aiff = os.path.join(td, "x.aiff")
        subprocess.run(["say", "-v", VOICE, "-r", str(RATE), "-o", aiff, text], check=True)
        subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-i", aiff, "-ac", "1", "-ar", str(SR), "-sample_fmt", "s16", path], check=True)


def read_pcm(path):
    with wave.open(path) as w:
        assert w.getframerate() == SR and w.getnchannels() == 1
        return w.readframes(w.getnframes())


def write_pcm(path, pcm):
    with wave.open(path, "wb") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR); w.writeframes(pcm)


def main():
    os.makedirs(os.path.join(ROOT, "slides"), exist_ok=True)
    images = []
    slides_json = []
    for i, s in enumerate(SLIDES):
        img = render_png(s, i); images.append(img)
        rel = f"fixtures/slides/slide-{i + 1}.png"
        img.save(os.path.join(ROOT, "slides", f"slide-{i + 1}.png"), optimize=True)
        slides_json.append({"index": i, "text": slide_text(s), "image": rel, "imageOnly": bool(s.get("imageOnly"))})
    with open(os.path.join(ROOT, "deck.pdf"), "wb") as f:
        f.write(build_pdf(images))
    with open(os.path.join(ROOT, "slides.json"), "w") as f:
        json.dump(slides_json, f, indent=2, ensure_ascii=False)

    silence = b"\x00\x00" * int(GAP * SR)
    pcm = bytearray(silence)  # lead-in
    segs = []
    with tempfile.TemporaryDirectory() as td:
        for i, n in enumerate(NARRATION):
            p = os.path.join(td, f"s{i}.wav"); tts_to_wav(n["text"], p)
            chunk = read_pcm(p)
            t0 = len(pcm) / 2 / SR
            pcm += chunk
            t1 = len(pcm) / 2 / SR
            pcm += silence
            segs.append({"slideIndex": i, "tStart": round(t0, 2), "tEnd": round(t1, 2), "text": n["text"], "notOnSlide": n["notOnSlide"]})
        write_pcm(os.path.join(ROOT, "lecture.wav"), bytes(pcm))
        ep = os.path.join(td, "e.wav"); tts_to_wav(EXPLAIN["text"], ep)
        write_pcm(os.path.join(ROOT, "explain.wav"), silence[: SR] + read_pcm(ep) + silence[: SR])

    script = {**MODULE, "deck": "fixtures/deck.pdf", "audio": "fixtures/lecture.wav", "sampleRate": SR,
              "durationSec": round(len(pcm) / 2 / SR, 2), "voice": f"macOS say -v {VOICE} -r {RATE}",
              "segments": segs, "explain": {**EXPLAIN, "audio": "fixtures/explain.wav"}}
    with open(os.path.join(ROOT, "lecture.script.json"), "w") as f:
        json.dump(script, f, indent=2, ensure_ascii=False)
    print(f"ok: {len(SLIDES)} slides, lecture {script['durationSec']}s, {len(segs)} segments")


if __name__ == "__main__":
    main()
