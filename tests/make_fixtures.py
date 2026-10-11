"""Builds the offline test fixtures. Needs reportlab (dev only):

    python tests/make_fixtures.py

The PDFs copy the layout of the real AWBI lists: wrapped cells, vertically
centred text, page titles repeated mid-list, and Karnataka rows mixed with
other states (including a KA code whose state is Delhi).
"""

import os

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib.styles import ParagraphStyle
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

HERE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "fixtures")

REC_HEAD = ["S.No.", "Code No", "Name of the AWO", "Address", "District", "State",
            "Date of Recognition", "Date of Renewal", "Valid upto"]
REC_ROWS = [
    ["1", "AP002/1964", "Peela Ramakrishna Memorial Jeevraksha Sangham",
     "Indira Nagar, 1st Ln, Nalla Cheruvu, Guntur 522003,", "Guntur", "Andhra Pradesh", "N/A", "N.A.", "-"],
    ["2", "AP056/2000", "Animal Care Land",
     "House No.13-6-600-44-157G,II Floor, Peddakapu Layout, 517501", "Tirupati", "Andhra Pradesh",
     "21.11.2001", "14.05.2025", "13.05.2030"],
    ["3", "KA001/1965", "Mysore Panjrapole Society",
     "Chamundi Hill Foot,Nanjangud Rd., 570025", "Mysore", "Karnataka", "N/A", "N.A.", "-"],
    ["4", "KA004/1993", "Compassion Unlimited Plus Action",
     "No.18/1, D-Ground Floor, Kensington Apartments, Ulsoor Cross Road, Ulsoor,560008",
     "Bangalore", "Karnataka", "16.12.1993", "19.07.2023", "18.07.2028"],
    ["5", "KA008/1991", "Indian Vety. Association",
     "C/o Dr.V.K.Kashyap,143 A Sarai Kale Khan, Po.Hazarath Nizamuddin, 110013",
     "New Delhi", "Delhi", "N/A", "N.A.", "-"],
    ["6", "KA017/1999", "Wildlife Rescue & Rehabilitation Centre",
     "Southern Cross, 9 A, Myrtle Lane, Richmond Town, 560025", "Bangalore", "Karnataka",
     "N/A", "N.A.", "-"],
    ["7", "KA021/2000", "Animal Care Trust",
     "\"Albuquerque Chambers\", Pandeshwar, 575001", "Mangalore", "Karnataka",
     "06.06.2000", "22.11.2023", "21.11.2028"],
    ["8", "KA040/2005", "Swapna Samrakshana Samiti",
     "NH 17, Near Devbag Cross,, Tehsil Karwar, 581352", "Sadashivgad", "Karnataka",
     "19.12.2005", "N.A.", "-"],
    ["9", "KA067/2018", "Charlies Animal Rescue Centre (CARE)",
     "Pranavam, 1/1, Sulthanpalya 1st Cross, Behind Pushpanjali Theatre, 560032",
     "Bengaluru", "Karnataka", "05.02.2018", "09.01.2025", "08.01.2030"],
    ["10", "KA073/2019", "Captain's Animal Care Trust",
     "24, Ananth Nagar, Manipal, 576104", "Udupi", "Karnataka", "07.03.2019", "09.01.2025", "08.01.2030"],
    ["11", "KA074/2020", "Shri Umamaheswara Seva Trust",
     "Hosagunda, Post-Nandithale, Sagar Taluk, 293589", "Dist-Shimoga", "Karnataka",
     "07.03.2019", "N.A.", "-"],
    ["12", "KA077/2021", "Punyakoti Gorakshana Vedika",
     "Post- Varadhamulla, Sagar Taluk, Kuntagodu, 577401", "Shimoga", "Karnataka",
     "21.08.2020", "N.A.", "20.08.2025"],
    ["13", "KA079/2023", "Shri Veeranjaneya Religious & Charitable Trust",
     "Vill-Shrikshetra Bangaramakki, Post-Gerasoppa, Honnavara, 581384", "Uttara Kannada",
     "Karnataka", "16.05.2022", "N.A.", "21.04.2027"],
    ["14", "KA086/2025", "Srinivasa Taarini Charitable Trust",
     "No.49, Turahalli, Colony, Uttarahalli Hobli, Post -Subramanya, Bangalore- 560061",
     "Bangalore", "Karnataka", "18.07.2025", "N.A.", "17.07.2030"],
    ["15", "KL004/1991", "Elephant Welfare Association",
     "Flat No.2, Gangothri Apartments, Paliyam Lane,", "Thrissur", "Kerala", "08.12.2000", "N.A.", "-"],
]

ABC_HEAD = ["Sl. No", "Name of the Organisation", "Details of the ABC Centre", "District", "State",
            "Date of ABC Project Recognition", "ABC Project Recognition Valid up to"]
ABC_ROWS = [
    ["1.", "Universal Animal Welfare Society (Offline) (MH167/2016)", "Wadaki", "Wadaki",
     "Maharashtra", "28.07.2023", "27.07.2026"],
    ["2.", "Spandana Animal Welfare & Prakruthi Seva Society (KA082/2023)",
     "Hoodi Main Road, Bangaluru", "Bangaluru", "Karnataka", "04.11.2024", "03.11.2027"],
    ["3.", "Bruhat Bengaluru Mahanagara Palike", "Kengeri ABC Centre", "Bengaluru",
     "Karnataka", "10.09.2024", "09.09.2027"],
    ["4.", "Captain's Animal Care Trust (KA073/2019)", "Manipal, Udupi", "UDUPI", "Karnataka",
     "29.08.2025", "28.08.2028"],
]

TITLE_REC = "List of Animal Welfare Organizations recognised by the Animal Welfare Board of India (as on 31.03.2026)"
TITLE_ABC = "List of Animal Welfare Organisations (AWOs)/Municipal Corporations Granted ABC Project Recognition"


def _table(head, rows, widths, ruled, centre_head=False):
    cell = ParagraphStyle("c", fontName="Helvetica", fontSize=8, leading=10)
    head_style = ParagraphStyle("h", parent=cell, alignment=1 if centre_head else 0)
    data = [[Paragraph(h, head_style) for h in head]] + [[Paragraph(c, cell) for c in r] for r in rows]
    t = Table(data, colWidths=widths, repeatRows=1)
    style = [("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
             ("TOPPADDING", (0, 0), (-1, -1), 4), ("BOTTOMPADDING", (0, 0), (-1, -1), 4)]
    if ruled:
        style.append(("GRID", (0, 0), (-1, -1), 0.5, colors.black))
    t.setStyle(TableStyle(style))
    return t


def build(path, title, head, rows, widths, ruled, centre_head=False):
    title_style = ParagraphStyle("t", fontName="Helvetica-Bold", fontSize=10, leading=12)
    doc = SimpleDocTemplate(path, pagesize=landscape(A4), leftMargin=30, rightMargin=30,
                            topMargin=30, bottomMargin=30)
    half = len(rows) // 2
    story = [Paragraph(title, title_style), Spacer(1, 8),
             _table(head, rows[:half], widths, ruled, centre_head),
             Spacer(1, 6), Paragraph(title, title_style), Spacer(1, 6),
             _table(head, rows[half:], widths, ruled, centre_head)]
    doc.build(story)


if __name__ == "__main__":
    os.makedirs(HERE, exist_ok=True)
    rec_w = [36, 70, 140, 220, 80, 80, 70, 60, 60]
    abc_w = [40, 220, 160, 90, 90, 80, 80]
    build(os.path.join(HERE, "awbi_recognised_ruled.pdf"), TITLE_REC, REC_HEAD, REC_ROWS, rec_w, True)
    build(os.path.join(HERE, "awbi_recognised_plain.pdf"), TITLE_REC, REC_HEAD, REC_ROWS, rec_w, False)
    build(os.path.join(HERE, "awbi_recognised_centred.pdf"), TITLE_REC, REC_HEAD, REC_ROWS, rec_w, False, True)
    build(os.path.join(HERE, "awbi_abc_ruled.pdf"), TITLE_ABC, ABC_HEAD, ABC_ROWS, abc_w, True)
    print("fixtures written to", HERE)
