import express from "express";
import multer from "multer";
import { execFile } from "child_process";
import fs from "fs/promises";
import os from "os";
import path from "path";
import crypto from "crypto";

const app = express();
const PORT = process.env.PORT || 10000;

// ======================================================
// CORS
// ======================================================

app.use((req, res, next) => {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    res.header("Access-Control-Allow-Headers", "Content-Type");

    if (req.method === "OPTIONS") {
        return res.sendStatus(204);
    }

    next();
});

// ======================================================
// HOME
// ======================================================

app.get("/", (req, res) => {
    res.json({
        ok: true,
        service: "PikaTools PDF Compressor"
    });
});

// ======================================================
// TEST GET ROUTE
// ======================================================

app.get("/api/pdf/compress", (req, res) => {
    res.json({
        ok: true,
        message: "PDF API route is reachable"
    });
});

// ======================================================
// REQUEST LOGGER
// ======================================================

app.use((req, res, next) => {
    console.log("REQUEST:", req.method, req.url);
    next();
});

// ======================================================
// MULTER
// ======================================================

const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: 25 * 1024 * 1024
    },
    fileFilter: (req, file, cb) => {
        const isPdf =
            file.mimetype === "application/pdf" ||
            file.originalname.toLowerCase().endsWith(".pdf");

        if (!isPdf) {
            return cb(new Error("Only PDF files are allowed."));
        }

        cb(null, true);
    }
});

// ======================================================
// RUN COMMAND HELPER
// ======================================================

function runCommand(command, args, options = {}) {
    return new Promise((resolve, reject) => {
        execFile(
            command,
            args,
            {
                timeout: 5 * 60 * 1000,
                maxBuffer: 10 * 1024 * 1024,
                ...options
            },
            (error, stdout, stderr) => {
                if (error) {
                    reject({
                        error,
                        stdout,
                        stderr
                    });
                    return;
                }

                resolve({
                    stdout,
                    stderr
                });
            }
        );
    });
}

// ======================================================
// QPDF QUICK OPTIMIZATION
// ======================================================

async function tryQpdf(inputPath, outputPath) {
    console.log("STARTING QPDF QUICK OPTIMIZATION...");

    try {
        await runCommand("qpdf", [
            "--stream-data=compress",
            "--compress-streams=y",
            "--object-streams=generate",
            inputPath,
            outputPath
        ]);

        const output = await fs.readFile(outputPath);

        console.log(
            "QPDF OUTPUT SIZE:",
            output.length,
            "bytes"
        );

        return output;
    } catch (result) {
        console.error("QPDF FAILED");

        console.error(
            result?.stderr ||
            result?.error?.message ||
            "Unknown qpdf error"
        );

        return null;
    }
}

// ======================================================
// GHOSTSCRIPT SETTINGS
// ======================================================

function ghostscriptArgs(level) {

    // FAST
    if (level === "fast") {
        return [
            "-sDEVICE=pdfwrite",
            "-dCompatibilityLevel=1.4",
            "-dPDFSETTINGS=/screen",

            "-dCompressFonts=true",
            "-dSubsetFonts=true",

            "-dNOPAUSE",
            "-dQUIET",
            "-dBATCH"
        ];
    }

    // EXTREME
    if (level === "extreme") {
        return [
            "-sDEVICE=pdfwrite",
            "-dCompatibilityLevel=1.4",
            "-dPDFSETTINGS=/screen",

            "-dDownsampleColorImages=true",
            "-dColorImageResolution=72",
            "-dColorImageDownsampleType=/Bicubic",

            "-dDownsampleGrayImages=true",
            "-dGrayImageResolution=72",
            "-dGrayImageDownsampleType=/Bicubic",

            "-dDownsampleMonoImages=true",
            "-dMonoImageResolution=150",

            "-dCompressFonts=true",
            "-dSubsetFonts=true",

            "-dNOPAUSE",
            "-dQUIET",
            "-dBATCH"
        ];
    }

    // QUALITY
    if (level === "quality") {
        return [
            "-sDEVICE=pdfwrite",
            "-dCompatibilityLevel=1.4",
            "-dPDFSETTINGS=/printer",

            "-dDetectDuplicateImages=true",
            "-dCompressFonts=true",
            "-dSubsetFonts=true",

            "-dNOPAUSE",
            "-dQUIET",
            "-dBATCH"
        ];
    }

    // BALANCED
    return [
        "-sDEVICE=pdfwrite",
        "-dCompatibilityLevel=1.4",
        "-dPDFSETTINGS=/ebook",

        "-dDownsampleColorImages=true",
        "-dColorImageResolution=110",
        "-dColorImageDownsampleType=/Average",

        "-dDownsampleGrayImages=true",
        "-dGrayImageResolution=110",
        "-dGrayImageDownsampleType=/Average",

        "-dDownsampleMonoImages=true",
        "-dMonoImageResolution=200",

        "-dCompressFonts=true",
        "-dSubsetFonts=true",

        "-dNOPAUSE",
        "-dQUIET",
        "-dBATCH"
    ];
}

// ======================================================
// GHOSTSCRIPT
// ======================================================

async function runGhostscript(
    inputPath,
    outputPath,
    level
) {
    console.log(
        "STARTING GHOSTSCRIPT:",
        level
    );

    const args = [
        ...ghostscriptArgs(level),
        `-sOutputFile=${outputPath}`,
        inputPath
    ];

    console.log(
        "GHOSTSCRIPT ARGS:",
        args.join(" ")
    );

    await runCommand("gs", args);

    const output = await fs.readFile(outputPath);

    console.log(
        "GHOSTSCRIPT OUTPUT SIZE:",
        output.length,
        "bytes"
    );

    return output;
}

// ======================================================
// PDF COMPRESS API
// ======================================================

app.post(
    "/api/pdf/compress",
    upload.single("file"),
    async (req, res) => {

        let inputPath = null;
        let qpdfPath = null;
        let gsPath = null;

        try {

            console.log("MULTER FINISHED");

            if (!req.file) {
                console.log("NO PDF FILE RECEIVED");

                return res.status(400).json({
                    error: "No PDF file received."
                });
            }

            console.log(
                "PDF RECEIVED:",
                req.file.originalname
            );

            console.log(
                "PDF SIZE:",
                req.file.size,
                "bytes"
            );

            const level =
                req.body?.level || "balanced";

            console.log(
                "COMPRESSION LEVEL:",
                level
            );

            const id = crypto.randomUUID();

            inputPath = path.join(
                os.tmpdir(),
                `pikatools-${id}-input.pdf`
            );

            qpdfPath = path.join(
                os.tmpdir(),
                `pikatools-${id}-qpdf.pdf`
            );

            gsPath = path.join(
                os.tmpdir(),
                `pikatools-${id}-gs.pdf`
            );

            console.log(
                "INPUT PATH:",
                inputPath
            );

            await fs.writeFile(
                inputPath,
                req.file.buffer
            );

            console.log(
                "PDF SAVED TO TEMP FILE"
            );

            // ==================================================
            // STEP 1: QUICK QPDF OPTIMIZATION
            // ==================================================

            const qpdfOutput =
                await tryQpdf(
                    inputPath,
                    qpdfPath
                );

            // If qpdf created a smaller PDF,
            // use it immediately for FAST mode.
            if (
                qpdfOutput &&
                qpdfOutput.length < req.file.size
            ) {

                const qpdfReduction =
                    (
                        (1 -
                            qpdfOutput.length /
                            req.file.size
                        ) * 100
                    ).toFixed(1);

                console.log(
                    `QPDF REDUCED SIZE BY ${qpdfReduction}%`
                );

                // FAST mode:
                // Don't run expensive Ghostscript
                // if qpdf already reduced the PDF.
                if (level === "fast") {

                    console.log(
                        "FAST MODE: USING QPDF RESULT"
                    );

                    return sendPdf(
                        res,
                        req.file,
                        qpdfOutput
                    );
                }
            }

            // ==================================================
            // STEP 2: GHOSTSCRIPT FALLBACK
            // ==================================================

            console.log(
                "QPDF WAS NOT ENOUGH."
            );

            console.log(
                "USING GHOSTSCRIPT FALLBACK..."
            );

            const gsOutput =
                await runGhostscript(
                    inputPath,
                    gsPath,
                    level
                );

            // ==================================================
            // CHOOSE SMALLEST VALID RESULT
            // ==================================================

            let finalBuffer = req.file.buffer;

            if (
                qpdfOutput &&
                qpdfOutput.length < finalBuffer.length
            ) {
                finalBuffer = qpdfOutput;
            }

            if (
                gsOutput &&
                gsOutput.length < finalBuffer.length
            ) {
                finalBuffer = gsOutput;
            }

            console.log(
                "FINAL SIZE:",
                finalBuffer.length,
                "bytes"
            );

            console.log(
                "ORIGINAL SIZE:",
                req.file.size,
                "bytes"
            );

            console.log(
                "FINAL REDUCTION:",
                (
                    (
                        1 -
                        finalBuffer.length /
                        req.file.size
                    ) * 100
                ).toFixed(1) + "%"
            );

            return sendPdf(
                res,
                req.file,
                finalBuffer
            );

        } catch (error) {

            console.error(
                "========== PDF API ERROR =========="
            );

            console.error(error);

            console.error(
                "==================================="
            );

            if (!res.headersSent) {
                res.status(500).json({
                    error:
                        error?.stderr ||
                        error?.message ||
                        error?.error?.message ||
                        "PDF compression failed."
                });
            }

        } finally {

            if (inputPath) {
                await fs
                    .unlink(inputPath)
                    .catch(() => {});
            }

            if (qpdfPath) {
                await fs
                    .unlink(qpdfPath)
                    .catch(() => {});
            }

            if (gsPath) {
                await fs
                    .unlink(gsPath)
                    .catch(() => {});
            }

            console.log(
                "TEMP FILE CLEANUP COMPLETE"
            );
        }
    }
);

// ======================================================
// SEND PDF
// ======================================================

function sendPdf(
    res,
    file,
    buffer
) {

    const compressed =
        buffer.length < file.size;

    const safeName =
        file.originalname
            .replace(/\.pdf$/i, "")
            .replace(
                /[^a-zA-Z0-9._-]/g,
                "_"
            );

    res.setHeader(
        "Content-Type",
        "application/pdf"
    );

    res.setHeader(
        "Content-Disposition",
        `attachment; filename="${safeName}${
            compressed
                ? "-compressed"
                : ""
        }.pdf"`
    );

    res.setHeader(
        "X-Original-Size",
        String(file.size)
    );

    res.setHeader(
        "X-Compressed-Size",
        String(buffer.length)
    );

    console.log(
        "SENDING PDF TO CLIENT..."
    );

    res.send(buffer);

    console.log(
        "PDF RESPONSE SENT"
    );
}

// ======================================================
// GLOBAL ERROR HANDLER
// ======================================================

app.use(
    (error, req, res, next) => {

        console.error(
            "GLOBAL ERROR:",
            error
        );

        if (!res.headersSent) {
            res.status(400).json({
                error:
                    error.message ||
                    "Request failed."
            });
        }
    }
);

// ======================================================
// START SERVER
// ======================================================

app.listen(
    PORT,
    "0.0.0.0",
    () => {

        console.log(
            `PikaTools PDF backend running on port ${PORT}`
        );
    }
);