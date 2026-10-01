import express from "express";
import cors from "cors";
import multer from "multer";
import { execFile } from "child_process";
import fs from "fs/promises";
import os from "os";
import path from "path";
import crypto from "crypto";

const app = express();

const PORT = process.env.PORT || 10000;

app.use(cors({
    origin: "*",
    methods: ["GET", "POST", "OPTIONS"]
}));

app.get("/", (req, res) => {
    res.json({
        ok: true,
        service: "PikaTools PDF Compressor"
    });
});


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
            return cb(
                new Error("Only PDF files are allowed.")
            );
        }

        cb(null, true);
    }
});


function ghostscriptArgs(level) {

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

            "-dDetectDuplicateImages=true",
            "-dCompressFonts=true",
            "-dSubsetFonts=true",

            "-dNOPAUSE",
            "-dQUIET",
            "-dBATCH"
        ];
    }


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


    return [
        "-sDEVICE=pdfwrite",
        "-dCompatibilityLevel=1.4",
        "-dPDFSETTINGS=/ebook",

        "-dDownsampleColorImages=true",
        "-dColorImageResolution=110",
        "-dColorImageDownsampleType=/Bicubic",

        "-dDownsampleGrayImages=true",
        "-dGrayImageResolution=110",
        "-dGrayImageDownsampleType=/Bicubic",

        "-dDownsampleMonoImages=true",
        "-dMonoImageResolution=200",

        "-dDetectDuplicateImages=true",
        "-dCompressFonts=true",
        "-dSubsetFonts=true",

        "-dNOPAUSE",
        "-dQUIET",
        "-dBATCH"
    ];
}


app.post(
    "/api/pdf/compress",
    upload.single("file"),
    async (req, res) => {

        let inputPath = null;
        let outputPath = null;

        try {

            if (!req.file) {
                return res.status(400).json({
                    error: "No PDF file received."
                });
            }


            const level =
                req.body?.level || "balanced";


            const id =
                crypto.randomUUID();


            inputPath =
                path.join(
                    os.tmpdir(),
                    `pikatools-${id}-input.pdf`
                );


            outputPath =
                path.join(
                    os.tmpdir(),
                    `pikatools-${id}-output.pdf`
                );


            await fs.writeFile(
                inputPath,
                req.file.buffer
            );


            const args = [
                ...ghostscriptArgs(level),
                `-sOutputFile=${outputPath}`,
                inputPath
            ];


            await new Promise(
                (resolve, reject) => {

                    execFile(
                        "gs",
                        args,
                        {
                            timeout: 5 * 60 * 1000,
                            maxBuffer: 10 * 1024 * 1024
                        },
                        (error, stdout, stderr) => {

                            if (error) {

                                console.error(
                                    "Ghostscript error:",
                                    stderr || error.message
                                );

                                reject(
                                    new Error(
                                        "PDF compression failed."
                                    )
                                );

                                return;
                            }

                            resolve();
                        }
                    );

                }
            );


            const output =
                await fs.readFile(
                    outputPath
                );


            /*
             * Never send a larger PDF.
             */
            const finalBuffer =
                output.length < req.file.size
                    ? output
                    : req.file.buffer;


            const compressed =
                output.length < req.file.size;


            const safeName =
                req.file.originalname
                    .replace(
                        /\.pdf$/i,
                        ""
                    )
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
                `attachment; filename="${safeName}${compressed ? "-compressed" : ""}.pdf"`
            );


            res.setHeader(
                "X-Original-Size",
                String(req.file.size)
            );


            res.setHeader(
                "X-Compressed-Size",
                String(finalBuffer.length)
            );


            res.send(finalBuffer);

        } catch (error) {

            console.error(
                "PDF API error:",
                error
            );


            if (!res.headersSent) {

                res.status(500).json({
                    error:
                        error.message ||
                        "PDF compression failed."
                });
            }

        } finally {

            if (inputPath) {

                await fs
                    .unlink(inputPath)
                    .catch(() => {});
            }


            if (outputPath) {

                await fs
                    .unlink(outputPath)
                    .catch(() => {});
            }
        }
    }
);


app.use(
    (error, req, res, next) => {

        console.error(error);

        res.status(400).json({
            error:
                error.message ||
                "Request failed."
        });
    }
);


app.listen(
    PORT,
    "0.0.0.0",
    () => {

        console.log(
            `PikaTools PDF backend running on port ${PORT}`
        );
    }
);