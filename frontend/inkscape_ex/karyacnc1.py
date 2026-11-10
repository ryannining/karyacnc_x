#!/usr/bin/env python
"""
Modified by Ryan widi saputra 2019-2020, reduce lots of code and leave important in the karyacnc javascript
Modified by Jay Johnson 2015, J Tech Photonics, Inc., jtechphotonics.com
modified by Adam Polak 2014, polakiumengineering.org

based on Copyright (C) 2009 Nick Drobchenko, nick@cnc-club.ru
based on gcode.py (C) 2007 hugomatic...
based on addnodes.py (C) 2005,2007 Aaron Spike, aaron@ekips.org
based on dots.py (C) 2005 Aaron Spike, aaron@ekips.org
based on interp.py (C) 2005 Aaron Spike, aaron@ekips.org
based on bezmisc.py (C) 2005 Aaron Spike, aaron@ekips.org
based on cubicsuperpath.py (C) 2005 Aaron Spike, aaron@ekips.org

This program is free software; you can redistribute it and/or modify
it under the terms of the GNU General Public License as published by
the Free Software Foundation; either version 2 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU General Public License for more details.

You should have received a copy of the GNU General Public License
along with this program; if not, write to the Free Software
Foundation, Inc., 59 Temple Place, Suite 330, Boston, MA  02111-1307  USA
"""

import inkex
from inkex.transforms import Transform
from inkex.paths import Path
import logging
import os
import tempfile
import socket
from lxml import etree

# Setup logging
log_dir = os.path.join(tempfile.gettempdir(), 'karyacnc_logs')
os.makedirs(log_dir, exist_ok=True)
log_file = os.path.join(log_dir, 'karyacnc.log')
logging.basicConfig(filename=log_file, level=logging.DEBUG)
logger = logging.getLogger(__name__)


################################################################################
###
###        Styles and additional parameters
###
################################################################################

options = {}

xyscale=1



################################################################################
###        print_ prints any arguments into specified log file
################################################################################

def print_(*arg):
    f = open(options.log_filename,"a")
    for s in arg :
        s = str(unicode(s).encode('unicode_escape'))+" "
        f.write( s )
    f.write("\n")
    f.close()



################################################################################
###
###        Gcodetools class
###
################################################################################
import re
class laser_gcode(inkex.Effect):
    def get_ip(self):
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        try:
            # doesn't even have to be reachable
            s.connect(('10.255.255.255', 1))
            IP = s.getsockname()[0]
        except Exception:
            IP = '127.0.0.1'
        finally:
            s.close()
        return IP

    def resolve_kip(self):
        kip = self.options.karyaws
        local_ip = self.get_ip().split('.')
        if not kip or kip[0] == ';':
            return "127.0.0.1"
        elif "." in kip:
            return kip
        else:
            # If only 1 digit/last number (or anything without dots)
            return f"{local_ip[0]}.{local_ip[1]}.{local_ip[2]}.{kip}"

    def send_nesting_request(self, method, path, fields=None, files=None):
        """Send an HTTP request for nesting using sockets."""
        host = self.resolve_kip()
        port = self.options.nesting_port

        boundary = '----Boundary' + os.urandom(16).hex()
        body = bytearray()

        if method == "POST":
            content_type = f'multipart/form-data; boundary={boundary}'
            if fields:
                for name, value in fields.items():
                    body.extend(f'--{boundary}\r\n'.encode('utf-8'))
                    body.extend(f'Content-Disposition: form-data; name="{name}"\r\n\r\n'.encode('utf-8'))
                    body.extend(f'{value}\r\n'.encode('utf-8'))
            if files:
                for field_name, file_info in files.items():
                    filename, data, f_content_type = file_info
                    if isinstance(data, str):
                        data = data.encode('utf-8')
                    body.extend(f'--{boundary}\r\n'.encode('utf-8'))
                    body.extend(f'Content-Disposition: form-data; name="{field_name}"; filename="{filename}"\r\n'.encode('utf-8'))
                    body.extend(f'Content-Type: {f_content_type}\r\n\r\n'.encode('utf-8'))
                    body.extend(data)
                    body.extend(b'\r\n')
            body.extend(f'--{boundary}--\r\n'.encode('utf-8'))
        else:
            content_type = 'application/x-www-form-urlencoded'

        headers = [
            f'{method} {path} HTTP/1.1',
            f'Host: {host}:{port}',
            f'Content-Type: {content_type}',
            f'Content-Length: {len(body)}',
            'Connection: close',
            '',
            ''
        ]
        request_head = '\r\n'.join(headers).encode('utf-8')

        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        sock.settimeout(30)
        try:
            sock.connect((host, port))
            sock.sendall(request_head + body)
            response_data = bytearray()
            while True:
                chunk = sock.recv(8192)
                if not chunk: break
                response_data.extend(chunk)
            response_text = response_data.decode('utf-8', errors='ignore')
            if '\r\n\r\n' not in response_text:
                raise Exception("Invalid server response")
            resp_headers, resp_body = response_text.split('\r\n\r\n', 1)
            status_line = resp_headers.split('\r\n')[0]
            status_code = int(status_line.split()[1])
            return status_code, resp_body
        finally:
            sock.close()

    def create_svg_from_selection(self, selected_paths):
        """Create a new SVG document containing only the selected elements."""
        svg = etree.Element("svg", nsmap=self.document.getroot().nsmap)
        svg.set("xmlns", "http://www.w3.org/2000/svg")
        
        # selected_paths is a dict {layer: [elements]}
        for layer in selected_paths:
            for element in selected_paths[layer]:
                if element.tag.endswith('}path') or element.tag == 'path':
                    clone = etree.fromstring(etree.tostring(element))
                else:
                    clone = self.shape_to_path(element)
                
                # Collect transform from element and all parent elements
                parent = element.getparent()
                total_transform = None
                while parent is not None and parent != self.document.getroot():
                    parent_transform = parent.get('transform', '')
                    if parent_transform:
                        t = Transform(parent_transform)
                        total_transform = (t @ total_transform) if total_transform else t
                    parent = parent.getparent()
                
                # Also get the transform from the element itself
                element_transform = element.get('transform', '')
                if element_transform:
                    t = Transform(element_transform)
                    total_transform = (t @ total_transform) if total_transform else t
                
                if total_transform:
                    clone.set('transform', str(total_transform))
                
                svg.append(clone)
        
        return etree.tostring(svg, encoding='unicode', method='xml')

    def shape_to_path(self, element):
        """Convert various SVG shapes to path elements."""
        tag = element.tag.split('}')[-1] if '}' in element.tag else element.tag
        path = etree.Element('path')
        for attr in ['id', 'style', 'fill', 'stroke', 'stroke-width', 'transform']:
            if element.get(attr):
                path.set(attr, element.get(attr))
        
        if tag == 'rect':
            x = float(element.get('x', 0))
            y = float(element.get('y', 0))
            width = float(element.get('width', 0))
            height = float(element.get('height', 0))
            rx = float(element.get('rx', 0))
            ry = float(element.get('ry', rx))
            if rx > 0 or ry > 0:
                rx = min(rx, width / 2)
                ry = min(ry, height / 2)
                d = f'M {x + rx},{y} L {x + width - rx},{y} Q {x + width},{y} {x + width},{y + ry} L {x + width},{y + height - ry} Q {x + width},{y + height} {x + width - rx},{y + height} L {x + rx},{y + height} Q {x},{y + height} {x},{y + height - ry} L {x},{y + ry} Q {x},{y} {x + rx},{y} Z'
            else:
                d = f'M {x},{y} L {x + width},{y} L {x + width},{y + height} L {x},{y + height} Z'
            path.set('d', d)
        elif tag == 'circle':
            cx = float(element.get('cx', 0))
            cy = float(element.get('cy', 0))
            r = float(element.get('r', 0))
            d = f'M {cx - r},{cy} A {r},{r} 0 1,0 {cx + r},{cy} A {r},{r} 0 1,0 {cx - r},{cy} Z'
            path.set('d', d)
        elif tag == 'ellipse':
            cx = float(element.get('cx', 0))
            cy = float(element.get('cy', 0))
            rx = float(element.get('rx', 0))
            ry = float(element.get('ry', 0))
            d = f'M {cx - rx},{cy} A {rx},{ry} 0 1,0 {cx + rx},{cy} A {rx},{ry} 0 1,0 {cx - rx},{cy} Z'
            path.set('d', d)
        elif tag == 'line':
            x1 = float(element.get('x1', 0))
            y1 = float(element.get('y1', 0))
            x2 = float(element.get('x2', 0))
            y2 = float(element.get('y2', 0))
            d = f'M {x1},{y1} L {x2},{y2}'
            path.set('d', d)
        elif tag == 'polyline':
            points = element.get('points', '')
            if points:
                point_list = points.replace(',', ' ').split()
                d = f'M {point_list[0]},{point_list[1]}'
                for i in range(2, len(point_list), 2):
                    d += f' L {point_list[i]},{point_list[i+1]}'
                path.set('d', d)
        elif tag == 'polygon':
            points = element.get('points', '')
            if points:
                point_list = points.replace(',', ' ').split()
                d = f'M {point_list[0]},{point_list[1]}'
                for i in range(2, len(point_list), 2):
                    d += f' L {point_list[i]},{point_list[i+1]}'
                d += ' Z'
                path.set('d', d)
        elif tag == 'path':
            return etree.fromstring(etree.tostring(element))
        else:
            return etree.fromstring(etree.tostring(element))
        return path

    def import_nested_svg(self, nested_svg, position=None):
        """Import the nested SVG content into the current document.
        If position (x, y) is given, the imported group is translated to that point."""
        # Get the current layer or create a new one
        try:
            layer = self.svg.get_current_layer()
        except:
            layer = self.document.getroot()

        # Create a group for the nested paths
        group = etree.SubElement(layer, inkex.addNS('g', 'svg'))
        group.set(inkex.addNS('label', 'inkscape'), 'Nested Parts')
        if position is not None:
            x, y = position
            group.set('transform', f'translate({x},{y})')

        # Import elements from the nested SVG preserving groups and paths
        def import_element(elem, parent_group):
            tag = elem.tag.split('}')[-1] if '}' in elem.tag else elem.tag
            if tag == 'g':
                sub_g = etree.SubElement(parent_group, inkex.addNS('g', 'svg'))
                for attr, value in elem.items():
                    sub_g.set(attr, value)
                for child in elem:
                    import_element(child, sub_g)
            elif tag == 'path':
                path = etree.SubElement(parent_group, inkex.addNS('path', 'svg'))
                for attr, value in elem.items():
                    path.set(attr, value)

        for element in nested_svg:
            import_element(element, group)

    def find_text_marker(self, keyword):
        """Find a selected text element whose content exactly matches `keyword`
        (case-insensitive, whitespace-trimmed). Returns (element, (x, y_below))
        with the position just below the text in document user space, or
        (None, None) if not found."""
        keyword = keyword.strip().lower()
        for layer in self.selected_paths:
            for elem in self.selected_paths[layer]:
                tag = elem.tag.split('}')[-1] if '}' in elem.tag else elem.tag
                if tag not in ('text', 'tspan'):
                    continue
                text_content = ''.join(elem.itertext()).strip().lower()
                if text_content != keyword:
                    continue
                return elem, self._text_position_below(elem)
        return None, None

    def _text_position_below(self, elem):
        """Compute a point at the bottom-center of the given text element in document space."""
        try:
            bbox = elem.bounding_box()
            if bbox is not None and (bbox.width > 0 or bbox.height > 0):
                return (bbox.center.x, bbox.bottom)
        except Exception:
            logger.exception("Error computing bounding box for nest marker")
        # Fallback: use x/y attributes and font-size from style
        x = float(elem.get('x', 0))
        y = float(elem.get('y', 0))
        font_size = 0.0
        style = elem.get('style', '')
        m = re.search(r'font-size:\s*([0-9.]+)', style)
        if m:
            font_size = float(m.group(1))
        return (x, y + font_size)

    def export_path(self,paths,xmin,ymin):
        f=0
        if (self.options.directory!="") :
            f = open(self.options.directory+self.options.filename, "w")
        ss=f"X:{xyscale}\n"
        gcodes=[ss]
        if (f):f.write(ss)
        for pp in paths:
            style=pp[0]
            ss=f"P:{style['fill:']}:{style['stroke:']}:{style['stroke-width:']}\n"
            for p in pp[1]:
                ss+=f"{p[0]-xmin},{p[1]-ymin}\n"
            ss+="\n"
            if (f):f.write(ss)
            gcodes.append(ss)    
        if (xmin>9000):
            for i in self.images:
                xlink = i.get('xlink:href')
                if xlink.startswith('data:'):
                    xx=float(i.get("x"))
                    yy=float(i.get("y"))
        nn=0
        for i in self.images:
            xlink = i.get('xlink:href')
            if xlink.startswith('data:'):
                if (nn==0):
                  nn=1
                  ss=f"K,{xmin},{ymin}\n"
                  gcodes.append(ss)		
                  if (f):f.write(ss)
                data = xlink[5:]
                (mimetype, data) = data.split(';', 1)
                (base, data) = data.split(',', 1)
                trans = Transform()
                element = i.getparent()
                root = self.document.getroot()
                while element != root:
                    if 'transform' in element.attrib:
                        trans = Transform(element.get('transform')) @ trans
                    element = element.getparent()
                
                # Hitung posisi absolut
                point = (float(i.get("x", "0")), float(i.get("y", "0")))
                xx, yy = trans.apply_to_point(point)

                point2 = (float(i.get("width", "0"))+point[0],float(i.get("height", "0"))+point[1])
                xx2,yy2=trans.apply_to_point(point2)
                width=xx2-xx
                height=yy2-yy
                tt=i.get("transform","")
                ss = f"I,{xx},{yy},{width},{height},{tt}\n{data}\n"
                gcodes.append(ss)		
                if (f):f.write(ss)
        
        if (f):f.close()
        if True: # Always attempt to send if action is karyacnc
            from websocket import create_connection
            kip = self.resolve_kip()
            try:    
                ws = create_connection(f"ws://{kip}:{self.options.port}/",3000)
                for g in gcodes:
                    n = 15000
                    chunks = [g[i:i+n] for i in range(0, len(g), n)]
                    for c in chunks:
                        ws.send(c)
                ws.send(">REVECTOR2")
            except Exception as e:
                inkex.errormsg(f"Failed to connect to KaryaCNC: {str(e)}")
            finally:
                if 'ws' in locals():
                    ws.close() 
                    del ws       

    def __init__(self):
        inkex.Effect.__init__(self)
        self.karyacnc=""
        self.arg_parser.add_argument("--directory",type=str,default="",help="Output directory")
        self.arg_parser.add_argument("--filename",type=str,default="output.gcode",help="File name")
        self.arg_parser.add_argument("--karyaws",type=str,default=";",help="KaryaCNC WS Server IP last number")
        self.arg_parser.add_argument("--nesting_port",type=int,default=3000,help="Nesting port")
        self.arg_parser.add_argument("--flatten",type=float,default="0.1",help="Flatten resolution")
        self.arg_parser.add_argument("--port",type=str,default="8887",help="Karyacnc port")
        # self.arg_parser.add_argument("--quiet_mode",type=str,default="false",help="Enable quiet mode (no success messages)")


    def get_transforms(self,g):
        root = self.document.getroot()
        trans = None
        while (g!=root):
            if 'transform' in g.keys():
                t = Transform(g.get('transform'))
                trans = (t@trans) if trans else t
            g=g.getparent()
        return trans


    def apply_transforms(self,g,csp):
        trans = self.get_transforms(g)
        return Path(csp).transform(trans).to_superpath() if trans else csp


    


################################################################################
###        Errors handling function, notes are just printed into Logfile,
###        warnings are printed into log file and warning message is displayed but
###        extension continues working, errors causes log and execution is halted
###        Notes, warnings adn errors could be assigned to space or comma or dot
###        sepparated strings (case is ignoreg).
################################################################################
    def error(self, s, type_= "Warning"):
        ## do nothing
        return



################################################################################
###
###        Get Gcodetools info from the svg
###
################################################################################
    def get_info(self):
        self.selected_paths = {}
        #self.paths = {}
        self.images= []
        self.orientation_points = {}
        self.layers = [self.document.getroot()]
        self.Zcoordinates = {}
        self.transform_matrix = {}
        self.transform_matrix_reverse = {}
        self.Zauto_scale = {}
        TAG1=inkex.addNS("g",'svg')
        TAG2=inkex.addNS('image','svg')
        TAG3=inkex.addNS('groupmode','inkscape')
        def recursive_search(g, layer, selected=False):
            if not(layer in self.selected_paths):
                self.selected_paths[layer]=[]
            for i in g.getchildren():
                itag=i.tag
                iid=i.get("id")
                iselected=selected
                if selected:
                    self.svg.selected[iid] = i
                else:
                    iselected=iid in self.svg.selected
                if itag == TAG1:
                    if i.get(TAG3) == 'layer':
                        self.layers.append(i)
                        recursive_search(i,i)
                    else:
                        recursive_search(i,layer, iselected )
                elif iselected :
                    if itag == TAG2:
                        self.images.append(i);
                    else:
                        self.selected_paths[layer].append(i)
        
        root=self.document.getroot()
        try:
          vb=root.get('viewBox').split(' ')
          vws=root.get('width')
          #vw=float(re.search("-?[0-9]*\.?\d+",vws)[0])
          #vh=float(root.get('height'))
          global xyscale
          xyscale=1.0#vw/(float(vb[2])-float(vb[0]))
          if (vws.find("pt")>0):xyscale=xyscale*127/360
        except:
          xyscale=1.0
          
        recursive_search(root,root)

    def laser(self) :
        gcode=""
        if (self.karyacnc):gcode = ";KARYACNC,"+self.karyacnc+"\n"
        
        getstyles=('fill:','stroke:','stroke-width:')
        attr_map={'fill':'fill:','stroke':'stroke:','stroke-width':'stroke-width:'}
        def parseStyle(node):
            res={}
            for attr,key in attr_map.items():
                v=node.get(attr)
                if v is not None:
                    res[key]=v
            if 'style' in node.attrib:
                style=node.get('style')
                if style!='':
                    styles=style.split(';')
                    for i in range(len(styles)):
                        for st in getstyles:
                            if styles[i].startswith(st):
                                res[st]=styles[i][len(st):]
            return res

        def getStyles(node):
            res={"fill:":"#ffffff","stroke:":"#000000","stroke-width:":"0","deep:":0,"repeat:":0}
            res['deep:']=node.get('deep')
            res['repeat:']=node.get('repeat')
            inherited = {}
            current = node
            root = self.document.getroot()
            while current is not None and current != root:
                parsed = parseStyle(current)
                for st in getstyles:
                    if st in parsed and st not in inherited:
                        inherited[st] = parsed[st]
                current = current.getparent()
            node_style = parseStyle(node)
            for st in getstyles:
                if st in node_style:
                    res[st] = node_style[st]
                elif st in inherited:
                    res[st] = inherited[st]
            return res

        
        if self.selected_paths == {} :
            paths=[]
            self.error(_("No paths are selected! Trying to work on all available paths."),"warning")
        else :
            paths = self.selected_paths
        from inkex.paths import CubicSuperPath
        kpaths = []
        xmin = 100000
        ymin = 100000

        for layer in [layer for layer in self.layers if layer in paths]:
            for path in paths[layer]:
                tag = path.tag.split('}')[-1] if '}' in path.tag else path.tag
                if tag in ('text', 'tspan'):
                    continue
                pstyle = getStyles(path)
                col = pstyle["fill:"]
                xpath = path.to_path_element()
                
                d = xpath.get('d')
                csp1 = CubicSuperPath(d)
                csp1 = self.apply_transforms(path, csp1)
                
                if any(char in d for char in ["A", "C", "Q", "a", "c", "q"]):
                    inkex.bezier.cspsubdiv(csp1, self.options.flatten * 0.2)
                
                for sp in csp1:
                    first = True
                    num=len(sp)
                    #gcode+=";"+str(cw)+"\n"
                    sum=0
                    ln=0
                    kpath=[]
                    for icsp in range(num):
                        csp=sp[icsp]
                        kpath.append((csp[1][0],csp[1][1]))
                        xmin=min(xmin,csp[1][0])
                        ymin=min(ymin,csp[1][1])
                        
                    kpaths.append((dict(pstyle), kpath))

        self.export_path(kpaths, xmin, ymin)


################################################################################
###
###        Effect
###
###        Main function of Gcodetools class
###
################################################################################
    def effect(self) :
        self.get_info()
        nest_elem, nest_position = self.find_text_marker("nest")
        result_elem, result_position = self.find_text_marker("result")

        # Collect selected non-text objects, excluding any marker text
        other_objects = {}
        for layer in self.selected_paths:
            for elem in self.selected_paths[layer]:
                if elem is nest_elem or elem is result_elem:
                    continue
                tag = elem.tag.split('}')[-1] if '}' in elem.tag else elem.tag
                if tag in ('text', 'tspan'):
                    continue
                other_objects.setdefault(layer, []).append(elem)

        # Upload: nest text with other objects
        if nest_elem is not None and other_objects:
            try:
                svg_data = self.create_svg_from_selection(other_objects)
                fields = {'inkscape': 'y'}
                files = {'svg_data': ('input.svg', svg_data, 'image/svg+xml')}
                status_code, _ = self.send_nesting_request("POST", "/upload_svg", fields, files)
                if status_code != 200:
                    inkex.errormsg(f"Failed to upload. Status code: {status_code}")
            except Exception as e:
                inkex.errormsg(f"Error during nesting upload: {str(e)}")
            return

        # Error: result text with other objects (must be alone)
        if result_elem is not None and other_objects:
            inkex.errormsg("Untuk download hasil nesting, pilih hanya teks 'result' tanpa objek lain.")
            return

        # Download: nest alone, or result alone
        dl_trigger = nest_elem if nest_elem is not None else result_elem
        dl_position = nest_position if nest_elem is not None else result_position

        if dl_trigger is not None:
            try:
                status_code, svg_content = self.send_nesting_request("GET", "/result_svg")
                if status_code == 200:
                    try:
                        start_idx = svg_content.find('<')
                        if start_idx != -1:
                            svg_content = svg_content[start_idx:]
                        nested_svg = etree.fromstring(svg_content.strip().encode('utf-8'))
                        self.import_nested_svg(nested_svg, position=dl_position)
                    except Exception as e:
                        logger.exception("Parser error")
                        inkex.errormsg(f"Error parsing SVG response: {str(e)}")
                elif status_code == 404:
                    inkex.errormsg("Blom ada hasil. Jalankan nesting lalu klik 'Select as Best' dulu.")
                else:
                    inkex.errormsg(f"Failed to retrieve solution. Status code: {status_code}")
            except Exception as e:
                inkex.errormsg(f"Error during nesting download: {str(e)}")
            return

        # No markers: gcode if there are objects, otherwise error
        if other_objects:
            self.laser()
        else:
            inkex.errormsg("Tidak ada seleksi. Pilih objek untuk G-code, teks 'nest' + objek untuk upload nesting, atau teks 'nest'/'result' sendirian untuk download hasil.")


if __name__ == '__main__':
    laser_gcode().run()
