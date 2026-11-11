DOC := dossier
OUT := $(DOC).pdf
SRC := $(DOC).tex

.PHONY: all clean watch

all: $(OUT)

$(OUT): $(SRC)
	@if command -v latexmk >/dev/null 2>&1; then \
		latexmk -pdf -interaction=nonstopmode -halt-on-error $(SRC); \
	else \
		pdflatex -interaction=nonstopmode -halt-on-error $(SRC); \
		pdflatex -interaction=nonstopmode -halt-on-error $(SRC); \
	fi

watch:
	@if ! command -v latexmk >/dev/null 2>&1; then \
		echo "latexmk required for watch mode"; exit 1; \
	fi
	latexmk -pdf -pvc -interaction=nonstopmode $(SRC)

clean:
	rm -f *.aux *.log *.out *.toc *.fls *.fdb_latexmk *.synctex.gz
	rm -f $(OUT)
