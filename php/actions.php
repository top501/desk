<?php

$DATA_ROOT_FROM_PHP="data/";
$CACHE_ROOT_FROM_PHP="cache/";
$ACTIONS_ROOT_FROM_PHP="action/";

$DIR_TO_PHP="/var/www/html/visu/desk/php/";


function myErrorHandler($errno, $errstr, $errfile, $errline) {
	die ("\n error while processing\n");
}
//set_error_handler("myErrorHandler");

function validatePath($file) {
$DATA_ROOT_FROM_PHP="data/";
$CACHE_ROOT_FROM_PHP="cache/";
$ACTIONS_ROOT_FROM_PHP="action/";

	$begining=substr($file, 0, strlen($DATA_ROOT_FROM_PHP));
	if ($begining==$DATA_ROOT_FROM_PHP)
		return("data");
	else
	{
		$begining=substr($file, 0, strlen($CACHE_ROOT_FROM_PHP));
		if ($begining==$CACHE_ROOT_FROM_PHP)
			return("cache");
		else
		{
			$begining=substr($file, 0, strlen($ACTIONS_ROOT_FROM_PHP));
			if ($begining==$ACTIONS_ROOT_FROM_PHP)
				return("action");
			else
			{
				die ("bad directory : $file\n".
				"begins with \"$begining\"\n".
				"must begin with \"$DATA_ROOT_FROM_PHP\"");
			}
		}
	}
}

$parametersList=array();

$actions = simplexml_load_file("../actions.xml")
	or die("Fichier introuvable. L'analyse a ete suspendue");

$actionToPerform=mysql_real_escape_string($_POST["action"])
	or die ("no action asked!");

//echo "action : $actionToPerform\n";

foreach ($actions->children() as $action)
{
	if ($action->getName()=="action")
	{
		$currentActionName=$action["name"]
			or die ("no name given for one action in xml file");

		if ($actionToPerform==$currentActionName)
		{
			$parametersList["action"]="$actionToPerform";
			$command=$action["executable"]
				or die("no executable provided for action \"$actionToPerform\"");
			// action was found in xml file, let's parse the parameters

			// first add mandatory output directory parameter
			$outputPirectoryParameter = $action->addChild('parameter');
			$outputPirectoryParameter->addAttribute('name', "output_directory");
			$outputPirectoryParameter->addAttribute('type', "directory");
			$outputPirectoryParameter->addAttribute('required', "true");
			$outputDirectory="";
			$inputFile="";

			foreach ($action->children() as $parameter)
			{
				if ($parameter->getName()=="parameter")
				{
					$parameterName=$parameter["name"];
//					echo $parameterName,"\n";
					$parameterType=$parameter["type"];

					$try=$_POST[''.$parameterName];
					$parameterValue=mysql_real_escape_string($try);
					if (($parameter["required"]=="true") && ($parameterValue==null))
					{
						die ("parameter $parameterName is required for the server\n".
							$try);
					}

					if ($parameterValue!=null) 
					{
						$prependPHP_DIR=false;
						switch ($parameterType)
						{
							case "string":
								if (strpos($parameterValue," ")
									||strpos($parameterValue,"/"))
									die ("$parameterName : string \"$parameterValue\" should contain no special characters!");
								break;
							case "file":
								validatePath($parameterValue);
								if (!is_file($parameterValue))
									die ("$parameterName : file \"$parameterValue\" does not exist");
								if ($parameterName=="input_file")
									$inputFile=$parameterValue;
								$prependPHP_DIR=true;
								break;
							case "directory":
								validatePath($parameterValue);
								if (!is_dir($parameterValue))
									die ("$parameterName : directory \"$parameterValue\" does not exist");
								if ($parameterName=="output_directory")
									$outputDirectory=$parameterValue;
								$prependPHP_DIR=true;
								break;
							case "int":
								if (!ctype_digit("$parameterValue"))
									die ("$parameterName : value \"$parameterValue\" is not an integer value");
								$value=floatVal($parameterValue);
								$min=$parameter["min"];
								if ($min!="")
								{
									$min=floatVal($min);
									if ($min>$value)
										die ("$parameterName : value $parameterValue should be bigger than $min");
								}
								$max=$parameter["max"];
								if ($max!="")
								{
									$max=floatVal($max);
									if ($max<$value)
										die ("$parameterName : value $parameterValue should be smaller than $max");
								}
								break;
							case "float":
								if (!is_numeric($parameterValue))
									die ("$parameterName : value \"$parameterValue\" is not a number");
								$value=floatVal($parameterValue);
								$min=$parameter["min"];
								if ($min!="")
								{
									$min=floatVal($min);
									if ($min>$value)
										die ("$parameterName : value $parameterValue should be bigger than $min");
								}
								$max=$parameter["max"];
								if ($max!="")
								{
									$max=floatVal($max);
									if ($max<$value)
										die ("$parameterName : value $parameterValue should be smaller than $max");
								}
								break;
							default :
								die ("no handler for type $parameterType");
						}
						$prefix=$parameter["prefix"];
						if ($prefix!="")
							$command.=" ".$prefix;

						$parametersList[''.$parameterName] = "$parameterValue";

						if ($prependPHP_DIR)
							$parameterValue="$DIR_TO_PHP$parameterValue";

						if ($parameterName!="output_directory")
							$command.=" ".$parameterValue;
					}
				}
				else
				{
					if ($parameter->getName()=="anchor")
					{
						$command.=" ".$parameter["text"];
					}
				}
			}

			switch (validatePath($outputDirectory))
			{
				case "cache":
					$outputDirectory="$CACHE_ROOT_FROM_PHP".sha1($command);
					if (!is_dir($outputDirectory))
						system("mkdir $outputDirectory");
					else
					{
						$filemtime=filemtime ( "$inputFile" );
						$outputmtime=filemtime ( "$outputDirectory" );
						if ($outputmtime>$filemtime)
						{
							echo "$outputDirectory\n";
							return;
						}
					}
					break;
				default:
			}
			$parametersList["output_directory"]=$outputDirectory;

			echo "$outputDirectory\n";
			chdir ($outputDirectory);
			$fp = fopen("parameters.txt", 'w+') or die("I could not open parameters.txt."); 

			$parametersList2=array();
			foreach ($parametersList as $parameter => $value)
				$parametersList2[]="$parameter=$value";

			fwrite($fp, implode("\n", $parametersList2));
			fclose($fp);
			echo "command : $command\n";
			system("$command");
		}
	}
}
?>
