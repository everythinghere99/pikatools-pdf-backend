import express from "express";
import multer from "multer";
import { execFile } from "child_process";
import fs from "fs/promises";
import os from "os";
import path from "path";
import crypto from "crypto";

const app = express();

const PORT = process.env.PORT || 10000;


// ===============================
// CORS
// ===============================

app.use((req, res, next) => {
    res.header("Access-Control-Allow-Origin", "*");
    res.header(
        "Access-Control-Allow-Methods",
        "GET,POST,OPTIONS"
    );
    res.header(
        "Access-Control-Allow-Headers",
        "Content-Type"
    );

    if (req.method === "OPTIONS") {
        return res.sendStatus(204);
    }

    next();
});


// ===============================
// HOME
// ===============================

app.get("/", (req, res) => {
    res.json({
        ok: true,
        service: "PikaTools PDF Compressor"
    });
});


// ===============================
// TEST GET ROUTE
// ===============================

app.get("/api/pdf/compress", (req, res) => {
    res.json({
        ok: true,
        message: "PDF API route is reachable"
    });
});


// ===============================
// REQUEST LOGGER
// ===============================

app.use((req, res, next) => {
    console.log(
        "REQUEST:",
        req.method,
        req.url
    );

    next();
});


// ===============================
// MULTER PDF UPLOAD
// ===============================

const upload = multer({

    storage: multer.memoryStorage(),

    limits: {
        fileSize: 25 * 1024 * 1024
    },

    fileFilter: (req, file, cb) => {

        const isPdf =
            file.mimetype === "application/pdf" ||
            file.originalname
                .toLowerCase()
                .endsWith(".pdf");

        if (!isPdf) {

            return cb(
                new Error(
                    "Only PDF files are allowed."
                )
            );
        }

        cb(null, true);
    }
});


// ===============================
// GHOSTSCRIPT SETTINGS
// ===============================

function ghostscriptArgs(level) {

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

            "-dDetectDuplicateImages=true",

            "-dCompressFonts=true",
            "-dSubsetFonts=true",

            "-dNOPAUSE",
            "-dQUIET",
            "-dBATCH"
        ];
    }

// FAST
if (level === "fast") {

    return [

        "-sDEVICE=pdfwrite",

        "-dCompatibilityLevel=1.4",

        "-dPDFSETTINGS=/screen",

        "-dDownsampleColorImages=true",
        "-dColorImageResolution=72",
        "-dColorImageDownsampleType=/Average",

        "-dDownsampleGrayImages=true",
        "-dGrayImageResolution=72",
        "-dGrayImageDownsampleType=/Average",

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


// ===============================
// PDF COMPRESS API
// ===============================

app.post(
    "/api/pdf/compress",

    upload.single("file"),

    async (req, res) => {

        let inputPath = null;
        let outputPath = null;

        try {

            // ---------------------------
            // MULTER COMPLETE
            // ---------------------------

            console.log(
                "MULTER FINISHED"
            );


            // ---------------------------
            // CHECK FILE
            // ---------------------------

            if (!req.file) {

                console.log(
                    "NO PDF FILE RECEIVED"
                );

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


            // ---------------------------
            // COMPRESSION LEVEL
            // ---------------------------

            const level =
                req.body?.level ||
                "balanced";

            console.log(
                "COMPRESSION LEVEL:",
                level
            );


            // ---------------------------
            // TEMP FILE PATHS
            // ---------------------------

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


            console.log(
                "INPUT PATH:",
                inputPath
            );

            console.log(
                "OUTPUT PATH:",
                outputPath
            );


            // ---------------------------
            // SAVE INPUT PDF
            // ---------------------------

            await fs.writeFile(
                inputPath,
                req.file.buffer
            );


            console.log(
                "PDF SAVED TO TEMP FILE"
            );


            // ---------------------------
            // GHOSTSCRIPT ARGUMENTS
            // ---------------------------

            const args = [

                ...ghostscriptArgs(level),

                `-sOutputFile=${outputPath}`,

                inputPath

            ];


            console.log(
                "GHOSTSCRIPT ARGUMENTS READY"
            );


            console.log(
                "STARTING GHOSTSCRIPT..."
            );


            // ---------------------------
            // RUN GHOSTSCRIPT
            // ---------------------------

            await new Promise(
                (resolve, reject) => {

                    execFile(

                        "gs",

                        args,

                        {
                            timeout:
                                5 * 60 * 1000,

                            maxBuffer:
                                10 * 1024 * 1024
                        },

                        (
                            error,
                            stdout,
                            stderr
                        ) => {

                            console.log(
                                "GHOSTSCRIPT CALLBACK FIRED"
                            );


                            if (error) {

                                console.error(
                                    "========== GHOSTSCRIPT FAILED =========="
                                );

                                console.error(
                                    "Exit code:",
                                    error.code
                                );

                                console.error(
                                    "Signal:",
                                    error.signal
                                );

                                console.error(
                                    "Killed:",
                                    error.killed
                                );

                                console.error(
                                    "STDOUT:",
                                    stdout
                                );

                                console.error(
                                    "STDERR:",
                                    stderr
                                );

                                console.error(
                                    "========================================"
                                );


                                reject(
                                    new Error(

                                        stderr?.trim() ||

                                        error.message ||

                                        "PDF compression failed."

                                    )
                                );

                                return;
                            }


                            console.log(
                                "GHOSTSCRIPT COMPLETED SUCCESSFULLY"
                            );


                            resolve();
                        }
                    );
                }
            );


            // ---------------------------
            // READ OUTPUT
            // ---------------------------

            console.log(
                "READING COMPRESSED PDF..."
            );


            const output =
                await fs.readFile(
                    outputPath
                );


            console.log(
                "OUTPUT SIZE:",
                output.length,
                "bytes"
            );


            // ---------------------------
            // NEVER RETURN LARGER FILE
            // ---------------------------

            const compressed =
                output.length <
                req.file.size;


            const finalBuffer =
                compressed
                    ? output
                    : req.file.buffer;


            console.log(
                "FINAL SIZE:",
                finalBuffer.length,
                "bytes"
            );


            console.log(
                "COMPRESSED:",
                compressed
            );


            // ---------------------------
            // SAFE FILE NAME
            // ---------------------------

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


            // ---------------------------
            // RESPONSE HEADERS
            // ---------------------------

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

                String(
                    req.file.size
                )
            );


            res.setHeader(
                "X-Compressed-Size",

                String(
                    finalBuffer.length
                )
            );


            // ---------------------------
            // SEND PDF
            // ---------------------------

            console.log(
                "SENDING PDF TO CLIENT..."
            );


            res.send(
                finalBuffer
            );


            console.log(
                "PDF RESPONSE SENT"
            );

        }


        // ===============================
        // ERROR
        // ===============================

        catch (error) {

            console.error(
                "========== PDF API ERROR =========="
            );

            console.error(
                error
            );

            console.error(
                "==================================="
            );


            if (!res.headersSent) {

                res.status(500).json({

                    error:
                        error.message ||

                        "PDF compression failed."

                });
            }
        }


        // ===============================
        // CLEANUP
        // ===============================

        finally {

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


            console.log(
                "TEMP FILE CLEANUP COMPLETE"
            );
        }
    }
);


// ===============================
// GLOBAL ERROR HANDLER
// ===============================

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


// ===============================
// START SERVER
// ===============================

app.listen(
    PORT,
    "0.0.0.0",
    () => {

        console.log(
            `PikaTools PDF backend running on port ${PORT}`
        );

    }
);