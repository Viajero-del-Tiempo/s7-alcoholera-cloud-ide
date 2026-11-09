"""Check the PLC source declarations and opcode labels without a TIA compiler."""

from pathlib import Path
import re
import sys


SOURCE_BLOCKS = {
    "UDT_LadderInst.udt": ("TYPE", "END_TYPE"),
    "DB_Comunicacion_HMI.db": ("DATA_BLOCK", "END_DATA_BLOCK"),
    "DB_Activo_Ladder.db": ("DATA_BLOCK", "END_DATA_BLOCK"),
    "FB_LadderEngine.scl": ("FUNCTION_BLOCK", "END_FUNCTION_BLOCK"),
}
DECLARATIONS = {
    "UDT_LadderInst.udt": (
        ("OpCode", "Int"),
        ("OperandIdx", "Int"),
        ("Param", "DInt"),
    ),
    "DB_Comunicacion_HMI.db": (
        ("NewProgramReady", "Bool"),
        ("EngineEnable", "Bool"),
        ("ResetAll", "Bool"),
        ("UseVirtualInputs", "Bool"),
        ("ActiveInstructions", "Int"),
        ("VirtualInputs", "Array[0..31]ofBool"),
        ("InputsState", "Array[0..31]ofBool"),
        ("OutputsState", "Array[0..31]ofBool"),
        ("MarkersState", "Array[0..63]ofBool"),
        ("UploadProgram", 'Array[0..199]of"UDT_LadderInst"'),
    ),
    "DB_Activo_Ladder.db": (
        ("Program", 'Array[0..199]of"UDT_LadderInst"'),
    ),
}
OPCODES = {0, 1, 2, 3, 4, 5, 6, 10, 11, 12, 20, 21}


def verify_sources(source_dir):
    errors = []
    for filename, (opening, closing) in SOURCE_BLOCKS.items():
        path = source_dir / filename
        try:
            source = path.read_text(encoding="ascii")
        except (OSError, UnicodeError) as error:
            errors.append(f"{filename}: {error}")
            continue

        source = re.sub(r"//[^\n]*|/\*.*?\*/", "", source, flags=re.DOTALL).strip()
        header = rf'{opening}\s+"{re.escape(path.stem)}"\s'
        if not re.match(header, source, flags=re.IGNORECASE):
            errors.append(f"{filename}: expected {opening} for {path.stem}")

        endings = re.findall(r"\bEND_(?:TYPE|DATA_BLOCK|FUNCTION_BLOCK)\b", source, re.IGNORECASE)
        if [end.upper() for end in endings] != [closing] or not source.upper().endswith(closing):
            errors.append(f"{filename}: expected a single {closing} at the end of the source")

        if path.suffix == ".db":
            standard_access = r"\{\s*S7_Optimized_Access\s*:=\s*'FALSE'\s*\}"
            if not re.match(header + r"\s*" + standard_access, source, re.IGNORECASE):
                errors.append(f"{filename}: expected S7_Optimized_Access := 'FALSE'")

        if filename in DECLARATIONS:
            fields = re.findall(r"^\s*(\w+)\s*:\s*([^\n;]+);", source, re.MULTILINE)
            declarations = tuple((name, re.sub(r"\s+", "", field_type)) for name, field_type in fields)
            if declarations != DECLARATIONS[filename]:
                errors.append(f"{filename}: field names, types or declaration order differ from contract")

        if path.suffix == ".scl":
            dispatches = re.findall(
                r"\bCASE\s+#Instruction\.OpCode\s+OF\b(.*?)\bEND_CASE\b",
                source,
                re.DOTALL | re.IGNORECASE,
            )
            dispatch = dispatches[-1] if dispatches else ""
            labels = [int(label) for label in re.findall(r"^\s*(\d+)\s*:", dispatch, re.MULTILINE)]
            if len(labels) != len(OPCODES) or set(labels) != OPCODES:
                errors.append(f"{filename}: expected exactly one CASE label per opcode {sorted(OPCODES)}")

    return errors


def main():
    errors = verify_sources(Path(__file__).resolve().parent)
    if errors:
        for error in errors:
            print(error, file=sys.stderr)
        return 1

    print("PLC source checks passed: 4 ASCII sources, standard DBs, contract declarations, 12 opcodes.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
